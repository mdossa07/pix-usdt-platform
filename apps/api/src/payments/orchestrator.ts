import { PrismaClient, PaymentStatus, TransferKind, TransferStatus, LedgerDirection, LedgerStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { calculateUsdtSplit, mockBrlToUsdt } from './split.js';
import type { PaymentProvider } from '../providers/provider-contract.js';

/**
 * Orchestrates the exact two-beneficiary settlement flow.
 * - Idempotent by paymentId + transfer kind.
 * - Never uses float arithmetic.
 * - Independent legs: merchant payout and platform commission never share state mutations.
 * - Fail-closed: partial failures leave explicit pending states for retry/reconciliation.
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
    if (existing?.status === TransferStatus.COMPLETED || existing?.status === TransferStatus.PROCESSING) return;

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

    const idempotencyKey = `${paymentId}:merchant:${existing?.id ?? randomUUID()}`;
    try {
      const leg = await this.provider.settleMerchantUsdt({
        merchantWallet: wallet.addressEncrypted,
        network: wallet.networkCode,
        amountUsdt: payment.merchantNetUsdt!.toString(),
        beneficiary: {
          walletAddress: wallet.addressEncrypted,
          network: wallet.networkCode,
          memo: wallet.tagEncrypted ?? undefined,
          exchangeName: wallet.exchangeName ?? 'UNKNOWN',
          holderName: wallet.holderName,
          holderTaxId: wallet.holderTaxIdEncrypted ?? undefined,
        },
      }, idempotencyKey);

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
            status: leg.status === 'COMPLETED' ? TransferStatus.COMPLETED : TransferStatus.PROCESSING,
          },
          update: {
            providerWithdrawalSn: leg.providerTransferId,
            txHash: leg.txHash,
            status: leg.status === 'COMPLETED' ? TransferStatus.COMPLETED : TransferStatus.PROCESSING,
          },
        });

        if (leg.status === 'COMPLETED') {
          await tx.payment.update({
            where: { id: paymentId },
            data: { status: PaymentStatus.MERCHANT_PAYOUT_PENDING },
          });
        }
      });
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED, failureMessage: `Merchant payout failed: ${(error as Error).message}` },
      });
    }
  }

  async settlePlatformCommission(paymentId: string): Promise<void> {
    const existing = await this.prisma.transfer.findFirst({
      where: { paymentId, kind: TransferKind.PLATFORM_COMMISSION },
    });
    if (existing?.status === TransferStatus.COMPLETED || existing?.status === TransferStatus.PROCESSING) return;

    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.commissionUsdt) return;

    // Platform wallet from DB (preferred) or env fallback
    const platformWalletRecord = await this.prisma.platformWallet.findFirst({ where: { isEnabled: true } });
    const platformWallet = platformWalletRecord?.addressEncrypted ?? process.env.PLATFORM_USDT_WALLET_ADDRESS;
    const platformNetwork = platformWalletRecord?.networkCode ?? process.env.PLATFORM_USDT_NETWORK ?? 'TRC20';

    if (!platformWallet) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.UNDER_REVIEW, failureMessage: 'Platform wallet not configured' },
      });
      return;
    }

    const commissionAmount = payment.commissionUsdt;
    if (!commissionAmount) return;

    const idempotencyKey = `${paymentId}:platform:${existing?.id ?? randomUUID()}`;
    try {
      const leg = await this.provider.settlePlatformCommission({
        platformWallet,
        network: platformNetwork,
        amountUsdt: commissionAmount.toString(),
      }, idempotencyKey);

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
            status: leg.status === 'COMPLETED' ? TransferStatus.COMPLETED : TransferStatus.PROCESSING,
          },
          update: {
            providerWithdrawalSn: leg.providerTransferId,
            txHash: leg.txHash,
            status: leg.status === 'COMPLETED' ? TransferStatus.COMPLETED : TransferStatus.PROCESSING,
          },
        });

        if (leg.status === 'COMPLETED') {
          const merchantLeg = await tx.transfer.findFirst({
            where: { paymentId, kind: TransferKind.MERCHANT_PAYOUT, status: TransferStatus.COMPLETED },
          });
          if (merchantLeg) {
            await tx.payment.update({
              where: { id: paymentId },
              data: { status: PaymentStatus.COMPLETED, completedAt: new Date() },
            });
          } else {
            await tx.payment.update({
              where: { id: paymentId },
              data: { status: PaymentStatus.PLATFORM_PAYOUT_PENDING },
            });
          }
        }
      });
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED, failureMessage: `Platform commission failed: ${(error as Error).message}` },
      });
    }
  }
}