import { PrismaClient, PaymentStatus, TransferKind, TransferStatus, LedgerDirection, LedgerStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { calculateUsdtSplit, mockBrlToUsdt } from './split.js';
import type { PaymentProvider } from '../providers/provider-contract.js';
import { decryptPii } from '../security/crypto.js';

/**
 * Orchestrates the exact two-beneficiary settlement flow.
 * - Idempotent by paymentId + transfer kind.
 * - Never uses float arithmetic.
 * - Independent legs: merchant payout and platform commission have separate status fields.
 * - Fail-closed: partial failures leave explicit pending states for retry/reconciliation.
 * - Timeout recovery: queries provider before re-sending to prevent double spend.
 */
export class PaymentOrchestrator {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: PaymentProvider,
    private readonly config: { commissionBps: number; mockRate: string; mode: 'mock' | 'sandbox' | 'live' },
  ) {}

  async handlePixConfirmed(paymentId: string, brlCents: bigint): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new Error('payment_not_found');
      if (payment.status !== PaymentStatus.PIX_CONFIRMED && payment.status !== PaymentStatus.CONVERSION_PENDING) {
        return; // already processed or in terminal state
      }

      const grossUsdt = mockBrlToUsdt(brlCents, this.config.mockRate); // TODO: real quote when live
      const split = calculateUsdtSplit(grossUsdt, this.config.commissionBps);

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CONVERSION_PENDING,
          providerGrossUsdt: split.totalUsdt,
          merchantNetUsdt: split.merchantUsdt,
          commissionUsdt: split.commissionUsdt,
          fxRate: this.config.mockRate,
          paidAt: new Date(),
        },
      });

      // Ledger entries for auditability (amounts as Decimal-compatible strings)
      await tx.ledgerEntry.createMany({
        data: [
          { paymentId, accountCode: 'PIX_RECEIVABLE', asset: 'BRL', direction: LedgerDirection.DEBIT, amount: (brlCents / 100n).toString(), status: LedgerStatus.POSTED, reference: `${paymentId}:brl:recv` },
          { paymentId, accountCode: 'USDT_GROSS', asset: 'USDT', direction: LedgerDirection.CREDIT, amount: split.totalUsdt, status: LedgerStatus.POSTED, reference: `${paymentId}:usdt:gross` },
          { paymentId, accountCode: 'PLATFORM_COMMISSION', asset: 'USDT', direction: LedgerDirection.DEBIT, amount: split.commissionUsdt, status: LedgerStatus.POSTED, reference: `${paymentId}:usdt:comm` },
          { paymentId, accountCode: 'MERCHANT_PAYABLE', asset: 'USDT', direction: LedgerDirection.CREDIT, amount: split.merchantUsdt, status: LedgerStatus.POSTED, reference: `${paymentId}:usdt:merch` },
        ],
      });
    }, { isolationLevel: 'Serializable' });

    // Trigger settlements outside transaction to avoid long locks
    await this.settleMerchantPayout(paymentId);
    await this.settlePlatformCommission(paymentId);
  }

  async settleMerchantPayout(paymentId: string): Promise<void> {
    const existing = await this.prisma.transfer.findFirst({
      where: { paymentId, kind: TransferKind.MERCHANT_PAYOUT },
    });

    // If already completed locally, just sync global state
    if (existing?.status === TransferStatus.COMPLETED) {
      await this.syncPaymentGlobalStatus(paymentId);
      return;
    }

    // Recovery: if we have a provider ID but local status is stale/unknown, query provider first
    if (existing?.providerWithdrawalSn && this.provider.getTransferStatus) {
      try {
        const remoteStatus = await this.provider.getTransferStatus(existing.providerWithdrawalSn, existing.idempotencyKey);
        if (remoteStatus?.status === 'COMPLETED') {
          await this.prisma.$transaction(async (tx) => {
            await tx.transfer.update({
              where: { id: existing.id },
              data: { status: TransferStatus.COMPLETED, txHash: remoteStatus.txHash ?? existing.txHash },
            });
            await tx.payment.update({
              where: { id: paymentId },
              data: { merchantTransferStatus: TransferStatus.COMPLETED },
            });
          });
          await this.syncPaymentGlobalStatus(paymentId);
          return;
        }
        if (remoteStatus?.status === 'FAILED') {
          await this.prisma.$transaction(async (tx) => {
            await tx.transfer.update({ where: { id: existing.id }, data: { status: TransferStatus.FAILED } });
            await tx.payment.update({ where: { id: paymentId }, data: { merchantTransferStatus: TransferStatus.FAILED } });
          });
          return;
        }
        // PENDING or null: fall through to retry with same idempotency key
      } catch {
        // Provider unreachable; proceed with cautious retry using existing idempotency key
      }
    }

    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { walletDestination: true },
    });

    const wallet = payment.walletDestination;
    if (wallet.status !== 'VERIFIED') {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.UNDER_REVIEW, failureMessage: 'Destination wallet not verified' },
      });
      return;
    }

    // Reuse existing idempotency key on retry to guarantee provider-side dedup
    const idempotencyKey = existing?.idempotencyKey ?? `${paymentId}:merchant:${randomUUID()}`;
    try {
      // Decrypt PII before sending to provider (audit item #7)
      const decryptedAddress = decryptPii(wallet.addressEncrypted);
      const decryptedMemo = wallet.tagEncrypted ? decryptPii(wallet.tagEncrypted) : undefined;
      const decryptedTaxId = wallet.holderTaxIdEncrypted ? decryptPii(wallet.holderTaxIdEncrypted) : undefined;

      const leg = await this.provider.settleMerchantUsdt({
        merchantWallet: decryptedAddress,
        network: wallet.networkCode,
        amountUsdt: payment.merchantNetUsdt!.toString(),
        beneficiary: {
          walletAddress: decryptedAddress,
          network: wallet.networkCode,
          memo: decryptedMemo,
          exchangeName: wallet.exchangeName ?? 'UNKNOWN',
          holderName: wallet.holderName,
          holderTaxId: decryptedTaxId,
        },
      }, idempotencyKey);

      const newStatus = leg.status === 'COMPLETED' ? TransferStatus.COMPLETED : TransferStatus.PROCESSING;

      await this.prisma.$transaction(async (tx) => {
        await tx.transfer.upsert({
          where: { idempotencyKey },
          create: {
            id: existing?.id ?? randomUUID(),
            paymentId,
            kind: TransferKind.MERCHANT_PAYOUT,
            amountUsdt: payment.merchantNetUsdt!,
            networkCode: wallet.networkCode,
            destinationAddressEnc: wallet.addressEncrypted,
            providerWithdrawalSn: leg.providerTransferId,
            txHash: leg.txHash,
            idempotencyKey,
            status: newStatus,
          },
          update: {
            providerWithdrawalSn: leg.providerTransferId,
            txHash: leg.txHash,
            status: newStatus,
          },
        });

        await tx.payment.update({
          where: { id: paymentId },
          data: { merchantTransferStatus: newStatus },
        });
      });

      if (newStatus === TransferStatus.COMPLETED) {
        await this.syncPaymentGlobalStatus(paymentId);
      }
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          merchantTransferStatus: TransferStatus.FAILED,
          status: PaymentStatus.FAILED,
          failureMessage: `Merchant payout failed: ${(error as Error).message}`,
        },
      });
    }
  }

  async settlePlatformCommission(paymentId: string): Promise<void> {
    const existing = await this.prisma.transfer.findFirst({
      where: { paymentId, kind: TransferKind.PLATFORM_COMMISSION },
    });

    if (existing?.status === TransferStatus.COMPLETED) {
      await this.syncPaymentGlobalStatus(paymentId);
      return;
    }

    // Recovery: query provider before retrying
    if (existing?.providerWithdrawalSn && this.provider.getTransferStatus) {
      try {
        const remoteStatus = await this.provider.getTransferStatus(existing.providerWithdrawalSn, existing.idempotencyKey);
        if (remoteStatus?.status === 'COMPLETED') {
          await this.prisma.$transaction(async (tx) => {
            await tx.transfer.update({
              where: { id: existing.id },
              data: { status: TransferStatus.COMPLETED, txHash: remoteStatus.txHash ?? existing.txHash },
            });
            await tx.payment.update({
              where: { id: paymentId },
              data: { platformTransferStatus: TransferStatus.COMPLETED },
            });
          });
          await this.syncPaymentGlobalStatus(paymentId);
          return;
        }
        if (remoteStatus?.status === 'FAILED') {
          await this.prisma.$transaction(async (tx) => {
            await tx.transfer.update({ where: { id: existing.id }, data: { status: TransferStatus.FAILED } });
            await tx.payment.update({ where: { id: paymentId }, data: { platformTransferStatus: TransferStatus.FAILED } });
          });
          return;
        }
      } catch {
        // Provider unreachable; proceed with cautious retry
      }
    }

    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.commissionUsdt) return;

    const platformWalletRecord = await this.prisma.platformWallet.findFirst({ where: { isEnabled: true } });
    const platformWalletEnc = platformWalletRecord?.addressEncrypted ?? process.env.PLATFORM_USDT_WALLET_ADDRESS;
    const platformNetwork = platformWalletRecord?.networkCode ?? process.env.PLATFORM_USDT_NETWORK ?? 'TRC20';

    if (!platformWalletEnc) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.UNDER_REVIEW, failureMessage: 'Platform wallet not configured' },
      });
      return;
    }

    // Decrypt platform wallet before sending to provider (audit item #7)
    const platformWallet = decryptPii(platformWalletEnc);

    const commissionAmount = payment.commissionUsdt;
    if (!commissionAmount) return;

    const idempotencyKey = existing?.idempotencyKey ?? `${paymentId}:platform:${randomUUID()}`;
    try {
      const leg = await this.provider.settlePlatformCommission({
        platformWallet,
        network: platformNetwork,
        amountUsdt: commissionAmount.toString(),
      }, idempotencyKey);

      const newStatus = leg.status === 'COMPLETED' ? TransferStatus.COMPLETED : TransferStatus.PROCESSING;

      await this.prisma.$transaction(async (tx) => {
        await tx.transfer.upsert({
          where: { idempotencyKey },
          create: {
            id: existing?.id ?? randomUUID(),
            paymentId,
            kind: TransferKind.PLATFORM_COMMISSION,
            amountUsdt: commissionAmount,
            networkCode: platformNetwork,
            destinationAddressEnc: platformWallet,
            providerWithdrawalSn: leg.providerTransferId,
            txHash: leg.txHash,
            idempotencyKey,
            status: newStatus,
          },
          update: {
            providerWithdrawalSn: leg.providerTransferId,
            txHash: leg.txHash,
            status: newStatus,
          },
        });

        await tx.payment.update({
          where: { id: paymentId },
          data: { platformTransferStatus: newStatus },
        });
      });

      if (newStatus === TransferStatus.COMPLETED) {
        await this.syncPaymentGlobalStatus(paymentId);
      }
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          platformTransferStatus: TransferStatus.FAILED,
          status: PaymentStatus.FAILED,
          failureMessage: `Platform commission failed: ${(error as Error).message}`,
        },
      });
    }
  }

  /**
   * Syncs the global Payment.status based on independent leg statuses.
   * COMPLETED only when BOTH legs are COMPLETED.
   * FAILED if either leg is FAILED and the other is not still PROCESSING.
   */
  private async syncPaymentGlobalStatus(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const merchant = payment.merchantTransferStatus;
    const platform = payment.platformTransferStatus;

    if (merchant === TransferStatus.COMPLETED && platform === TransferStatus.COMPLETED) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.COMPLETED, completedAt: new Date() },
      });
      return;
    }

    if (merchant === TransferStatus.FAILED || platform === TransferStatus.FAILED) {
      // Only mark globally failed if the other leg is not still processing
      const otherProcessing =
        (merchant === TransferStatus.PROCESSING || platform === TransferStatus.PROCESSING);
      if (!otherProcessing) {
        await this.prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.FAILED,
            failureMessage: payment.failureMessage ?? 'One or more settlement legs failed',
          },
        });
      }
      return;
    }

    // At least one leg completed, none failed → partial state
    if (merchant === TransferStatus.COMPLETED || platform === TransferStatus.COMPLETED) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.COMMISSION_TRANSFER_PENDING },
      });
    }
  }
}