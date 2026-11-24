import { transferAttemptIdempotencyKey } from './transfer-attempt.js';
import { derivePaymentAggregateStatus } from './payment-status.js';
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
    if (this.config.mode !== 'mock') {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.UNDER_REVIEW,
          failureCode: 'PROVIDER_HOMOLOGATION_REQUIRED',
          failureMessage: 'Provider settlement is blocked until real FX quoting and two-beneficiary payouts are certified.',
        },
      });
      return;
    }

    // The database amount is authoritative; never trust a queue payload to change settlement value.
    const shouldContinue = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new Error('payment_not_found');
      if (brlCents !== payment.amountBrlCents) throw new Error('payment_amount_mismatch');

      if (payment.status === PaymentStatus.PIX_CONFIRMED) {
        const grossUsdt = mockBrlToUsdt(payment.amountBrlCents, this.config.mockRate);
        const split = calculateUsdtSplit(grossUsdt, payment.commissionBps ?? this.config.commissionBps);
        const brlWhole = payment.amountBrlCents / 100n;
        const brlFraction = (payment.amountBrlCents % 100n).toString().padStart(2, '0');

        // Optimistic state transition: only one concurrent webhook/worker may
        // claim PIX_CONFIRMED and create the accounting entries for this payment.
        const claimed = await tx.payment.updateMany({
          where: { id: paymentId, status: PaymentStatus.PIX_CONFIRMED },
          data: {
            status: PaymentStatus.CONVERSION_PENDING,
            providerGrossUsdt: split.totalUsdt,
            merchantNetUsdt: split.merchantUsdt,
            commissionUsdt: split.commissionUsdt,
            fxRate: this.config.mockRate,
            paidAt: payment.paidAt ?? new Date(),
          },
        });

        if (claimed.count === 1) {
          await tx.ledgerEntry.createMany({
            data: [
              { paymentId, accountCode: 'PIX_RECEIVABLE', asset: 'BRL', direction: LedgerDirection.DEBIT, amount: `${brlWhole}.${brlFraction}`, status: LedgerStatus.POSTED, reference: `${paymentId}:brl:recv` },
              { paymentId, accountCode: 'USDT_GROSS', asset: 'USDT', direction: LedgerDirection.CREDIT, amount: split.totalUsdt, status: LedgerStatus.POSTED, reference: `${paymentId}:usdt:gross` },
              { paymentId, accountCode: 'PLATFORM_COMMISSION', asset: 'USDT', direction: LedgerDirection.DEBIT, amount: split.commissionUsdt, status: LedgerStatus.POSTED, reference: `${paymentId}:usdt:comm` },
              { paymentId, accountCode: 'MERCHANT_PAYABLE', asset: 'USDT', direction: LedgerDirection.CREDIT, amount: split.merchantUsdt, status: LedgerStatus.POSTED, reference: `${paymentId}:usdt:merch` },
            ],
            skipDuplicates: true,
          });
          return true;
        }
      }

      // A competing worker may have won the state transition. Read its committed
      // values and continue only when the full financial calculation is present.
      const latest = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!latest) throw new Error('payment_not_found');
      const resumableStatuses: PaymentStatus[] = [
        PaymentStatus.CONVERSION_PENDING,
        PaymentStatus.CRYPTO_CREDITED,
        PaymentStatus.COMMISSION_TRANSFER_PENDING,
        PaymentStatus.MERCHANT_PAYOUT_PENDING,
        PaymentStatus.PLATFORM_PAYOUT_PENDING,
        PaymentStatus.UNDER_REVIEW,
        PaymentStatus.FAILED,
      ];
      return resumableStatuses.includes(latest.status)
        && latest.providerGrossUsdt !== null
        && latest.merchantNetUsdt !== null
        && latest.commissionUsdt !== null;
    });

    if (!shouldContinue) return;

    // Do not pay either beneficiary until the merchant and both destination wallets
    // have passed onboarding checks. This avoids charging the 2% fee while the 98%
    // merchant leg is ineligible.
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { walletDestination: true, merchant: true },
    });
    const platformWallet = await this.prisma.platformWallet.findUnique({
      where: { networkCode: payment.walletDestination.networkCode },
    });
    if (
      !payment.merchant.isEnabled
      || payment.merchant.kycStatus !== 'APPROVED'
      || payment.walletDestination.status !== 'VERIFIED'
      || !platformWallet?.isEnabled
    ) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.UNDER_REVIEW,
          failureCode: 'SETTLEMENT_PREREQUISITES_NOT_MET',
          failureMessage: 'Merchant approval, verified destination wallet, and enabled platform wallet are required before settlement.',
        },
      });
      return;
    }

    // Run independent legs even if the first one fails; global completion is synced only after both.
    await this.settleMerchantPayout(paymentId);
    await this.settlePlatformCommission(paymentId);
    await this.syncPaymentGlobalStatus(paymentId);
  }

  async settleMerchantPayout(paymentId: string): Promise<void> {
    let existing = await this.prisma.transfer.findFirst({
      where: { paymentId, kind: TransferKind.MERCHANT_PAYOUT },
      orderBy: { createdAt: 'desc' },
    });

    if (existing?.status === TransferStatus.COMPLETED) {
      await this.syncPaymentGlobalStatus(paymentId);
      return;
    }

    const currentAttempt = existing;
    if (currentAttempt && (currentAttempt.providerWithdrawalSn || currentAttempt.status === TransferStatus.SUBMITTED)) {
      if (!this.provider.getTransferStatus) {
        await this.prisma.payment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.UNDER_REVIEW, failureCode: 'MERCHANT_PAYOUT_STATUS_UNAVAILABLE' },
        });
        return;
      }
      try {
        const remoteStatus = await this.provider.getTransferStatus(
          currentAttempt.providerWithdrawalSn,
          currentAttempt.idempotencyKey,
        );
        if (remoteStatus?.status === 'COMPLETED') {
          await this.prisma.$transaction(async (tx) => {
            await tx.transfer.update({
              where: { id: currentAttempt.id },
              data: {
                status: TransferStatus.COMPLETED,
                providerWithdrawalSn: remoteStatus.providerReference ?? currentAttempt.providerWithdrawalSn,
                txHash: remoteStatus.txHash ?? currentAttempt.txHash,
              },
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
            await tx.transfer.update({ where: { id: currentAttempt.id }, data: {
              status: TransferStatus.FAILED,
              providerWithdrawalSn: remoteStatus.providerReference ?? currentAttempt.providerWithdrawalSn,
            } });
            await tx.payment.update({
              where: { id: paymentId },
              data: { merchantTransferStatus: TransferStatus.FAILED },
            });
          });
          existing = { ...currentAttempt, status: TransferStatus.FAILED };
        } else if (remoteStatus?.status === 'PENDING') {
          await this.prisma.$transaction(async (tx) => {
            await tx.transfer.update({ where: { id: currentAttempt.id }, data: {
              status: TransferStatus.PROCESSING,
              providerWithdrawalSn: remoteStatus.providerReference ?? currentAttempt.providerWithdrawalSn,
            } });
            await tx.payment.update({
              where: { id: paymentId },
              data: { merchantTransferStatus: TransferStatus.PROCESSING },
            });
          });
          return;
        } else if (remoteStatus === null) {
          // A missing order is not proof that the provider did not accept the
          // request (eventual consistency/network ambiguity). Keep the claim.
          await this.prisma.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentStatus.UNDER_REVIEW,
              failureCode: 'MERCHANT_PAYOUT_NOT_FOUND_BY_PARTNER_ID',
              failureMessage: 'The provider could not yet locate this payout by its original partnerId. No automatic resubmission is allowed.',
            },
          });
          return;
        }
      } catch {
        // A failed status lookup is ambiguous. Never submit another payout.
        return;
      }
    } else if (
      currentAttempt
      && currentAttempt.status !== TransferStatus.CREATED
      && currentAttempt.status !== TransferStatus.FAILED
    ) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.UNDER_REVIEW,
          failureCode: 'MERCHANT_PAYOUT_REFERENCE_MISSING',
          failureMessage: 'The payout reference is missing and its attempt cannot be safely queried. Manual reconciliation is required.',
        },
      });
      return;
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

    const idempotencyKey = existing?.status === TransferStatus.FAILED
      ? transferAttemptIdempotencyKey(
          paymentId,
          TransferKind.MERCHANT_PAYOUT,
          Number(existing.idempotencyKey.split(':v').at(-1) ?? 1) + 1,
        )
      : existing?.idempotencyKey
        ?? transferAttemptIdempotencyKey(paymentId, TransferKind.MERCHANT_PAYOUT, 1);

    const decryptedAddress = decryptPii(wallet.addressEncrypted);
    const decryptedMemo = wallet.tagEncrypted ? decryptPii(wallet.tagEncrypted) : undefined;
    const decryptedTaxId = wallet.holderTaxIdEncrypted ? decryptPii(wallet.holderTaxIdEncrypted) : undefined;

    // Persist and atomically claim the transfer BEFORE calling the provider.
    // Only one worker can move this attempt from CREATED to SUBMITTED.
    const claimed = await this.prisma.$transaction(async (tx) => {
      // createMany(skipDuplicates) maps to INSERT .. ON CONFLICT DO NOTHING,
      // avoiding Prisma upsert's concurrent-create P2002 race between workers.
      await tx.transfer.createMany({
        data: [{
          id: randomUUID(),
          paymentId,
          kind: TransferKind.MERCHANT_PAYOUT,
          amountUsdt: payment.merchantNetUsdt!,
          networkCode: wallet.networkCode,
          destinationAddressEnc: wallet.addressEncrypted,
          idempotencyKey,
          status: TransferStatus.CREATED,
        }],
        skipDuplicates: true,
      });
      const attempt = await tx.transfer.findUnique({ where: { idempotencyKey } });
      if (!attempt) throw new Error('merchant_transfer_attempt_not_persisted');
      const claim = await tx.transfer.updateMany({
        where: { id: attempt.id, status: TransferStatus.CREATED },
        data: { status: TransferStatus.SUBMITTED },
      });
      if (claim.count !== 1) return false;
      await tx.payment.update({
        where: { id: paymentId },
        data: { merchantTransferStatus: TransferStatus.SUBMITTED },
      });
      return true;
    });
    if (!claimed) return;

    try {
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

      if (!leg.providerTransferId?.trim()) {
        throw new Error('provider_transfer_reference_missing');
      }
      const newStatus = leg.status === 'COMPLETED'
        ? TransferStatus.COMPLETED
        : leg.status === 'FAILED' ? TransferStatus.FAILED : TransferStatus.PROCESSING;

      await this.prisma.$transaction(async (tx) => {
        await tx.transfer.update({
          where: { idempotencyKey },
          data: {
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
    } catch {
      // The transfer row remains SUBMITTED as a durable claim. A timeout/error is
      // not proof of failure and must never authorize a second payout.
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          merchantTransferStatus: TransferStatus.SUBMITTED,
          status: PaymentStatus.UNDER_REVIEW,
          failureCode: 'MERCHANT_PAYOUT_OUTCOME_UNKNOWN',
          failureMessage: 'Merchant payout outcome is unknown. Reconcile with the provider before attempting another submission.',
        },
      });
    }
  }

  async settlePlatformCommission(paymentId: string): Promise<void> {
    let existing = await this.prisma.transfer.findFirst({
      where: { paymentId, kind: TransferKind.PLATFORM_COMMISSION },
      orderBy: { createdAt: 'desc' },
    });

    if (existing?.status === TransferStatus.COMPLETED) {
      await this.syncPaymentGlobalStatus(paymentId);
      return;
    }

    const currentAttempt = existing;
    if (currentAttempt && (currentAttempt.providerWithdrawalSn || currentAttempt.status === TransferStatus.SUBMITTED)) {
      if (!this.provider.getTransferStatus) {
        await this.prisma.payment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.UNDER_REVIEW, failureCode: 'PLATFORM_PAYOUT_STATUS_UNAVAILABLE' },
        });
        return;
      }
      try {
        const remoteStatus = await this.provider.getTransferStatus(
          currentAttempt.providerWithdrawalSn,
          currentAttempt.idempotencyKey,
        );
        if (remoteStatus?.status === 'COMPLETED') {
          await this.prisma.$transaction(async (tx) => {
            await tx.transfer.update({
              where: { id: currentAttempt.id },
              data: {
                status: TransferStatus.COMPLETED,
                providerWithdrawalSn: remoteStatus.providerReference ?? currentAttempt.providerWithdrawalSn,
                txHash: remoteStatus.txHash ?? currentAttempt.txHash,
              },
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
            await tx.transfer.update({ where: { id: currentAttempt.id }, data: {
              status: TransferStatus.FAILED,
              providerWithdrawalSn: remoteStatus.providerReference ?? currentAttempt.providerWithdrawalSn,
            } });
            await tx.payment.update({
              where: { id: paymentId },
              data: { platformTransferStatus: TransferStatus.FAILED },
            });
          });
          existing = { ...currentAttempt, status: TransferStatus.FAILED };
        } else if (remoteStatus?.status === 'PENDING') {
          await this.prisma.$transaction(async (tx) => {
            await tx.transfer.update({ where: { id: currentAttempt.id }, data: {
              status: TransferStatus.PROCESSING,
              providerWithdrawalSn: remoteStatus.providerReference ?? currentAttempt.providerWithdrawalSn,
            } });
            await tx.payment.update({
              where: { id: paymentId },
              data: { platformTransferStatus: TransferStatus.PROCESSING },
            });
          });
          return;
        } else if (remoteStatus === null) {
          await this.prisma.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentStatus.UNDER_REVIEW,
              failureCode: 'PLATFORM_PAYOUT_NOT_FOUND_BY_PARTNER_ID',
              failureMessage: 'The provider could not yet locate this payout by its original partnerId. No automatic resubmission is allowed.',
            },
          });
          return;
        }
      } catch {
        return;
      }
    } else if (
      currentAttempt
      && currentAttempt.status !== TransferStatus.CREATED
      && currentAttempt.status !== TransferStatus.FAILED
    ) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.UNDER_REVIEW,
          failureCode: 'PLATFORM_PAYOUT_REFERENCE_MISSING',
          failureMessage: 'The platform payout reference is missing and its attempt cannot be safely queried. Manual reconciliation is required.',
        },
      });
      return;
    }

    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { walletDestination: true },
    });
    if (!payment.commissionUsdt) return;

    const platformWalletRecord = await this.prisma.platformWallet.findUnique({
      where: { networkCode: payment.walletDestination.networkCode },
    });
    const platformWalletEnc = platformWalletRecord?.isEnabled ? platformWalletRecord.addressEncrypted : null;
    const platformNetwork = payment.walletDestination.networkCode;
    if (!platformWalletRecord || !platformWalletRecord.isEnabled || !platformWalletEnc) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.UNDER_REVIEW, failureMessage: 'Platform wallet not configured' },
      });
      return;
    }

    const platformWallet = decryptPii(platformWalletEnc);
    const commissionAmount = payment.commissionUsdt;
    const idempotencyKey = existing?.status === TransferStatus.FAILED
      ? transferAttemptIdempotencyKey(
          paymentId,
          TransferKind.PLATFORM_COMMISSION,
          Number(existing.idempotencyKey.split(':v').at(-1) ?? 1) + 1,
        )
      : existing?.idempotencyKey
        ?? transferAttemptIdempotencyKey(paymentId, TransferKind.PLATFORM_COMMISSION, 1);

    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.transfer.createMany({
        data: [{
          id: randomUUID(),
          paymentId,
          kind: TransferKind.PLATFORM_COMMISSION,
          amountUsdt: commissionAmount,
          networkCode: platformNetwork,
          destinationAddressEnc: platformWalletRecord.addressEncrypted,
          idempotencyKey,
          status: TransferStatus.CREATED,
        }],
        skipDuplicates: true,
      });
      const attempt = await tx.transfer.findUnique({ where: { idempotencyKey } });
      if (!attempt) throw new Error('platform_transfer_attempt_not_persisted');
      const claim = await tx.transfer.updateMany({
        where: { id: attempt.id, status: TransferStatus.CREATED },
        data: { status: TransferStatus.SUBMITTED },
      });
      if (claim.count !== 1) return false;
      await tx.payment.update({
        where: { id: paymentId },
        data: { platformTransferStatus: TransferStatus.SUBMITTED },
      });
      return true;
    });
    if (!claimed) return;

    try {
      const leg = await this.provider.settlePlatformCommission({
        platformWallet,
        network: platformNetwork,
        amountUsdt: commissionAmount.toString(),
      }, idempotencyKey);

      if (!leg.providerTransferId?.trim()) {
        throw new Error('provider_transfer_reference_missing');
      }
      const newStatus = leg.status === 'COMPLETED'
        ? TransferStatus.COMPLETED
        : leg.status === 'FAILED' ? TransferStatus.FAILED : TransferStatus.PROCESSING;

      await this.prisma.$transaction(async (tx) => {
        await tx.transfer.update({
          where: { idempotencyKey },
          data: {
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
    } catch {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          platformTransferStatus: TransferStatus.SUBMITTED,
          status: PaymentStatus.UNDER_REVIEW,
          failureCode: 'PLATFORM_PAYOUT_OUTCOME_UNKNOWN',
          failureMessage: 'Platform commission payout outcome is unknown. Reconcile with the provider before attempting another submission.',
        },
      });
    }
  }

  /**
   * Completes the payment only after both independent beneficiary transfers settle.
   * A provider/network error never changes a submitted transfer to FAILED.
   */
  private async syncPaymentGlobalStatus(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const status = derivePaymentAggregateStatus(
      payment.merchantTransferStatus,
      payment.platformTransferStatus,
    );
    const data: {
      status: PaymentStatus;
      completedAt?: Date;
      failureCode?: string | null;
      failureMessage?: string | null;
    } = { status };

    if (status === PaymentStatus.COMPLETED) {
      data.completedAt = payment.completedAt ?? new Date();
      data.failureCode = null;
      data.failureMessage = null;
    } else if (status === PaymentStatus.UNDER_REVIEW) {
      data.failureCode = payment.failureCode ?? 'PAYOUT_REQUIRES_REVIEW';
      data.failureMessage = payment.failureMessage ?? 'A payout leg requires reconciliation before this payment can complete.';
    }

    await this.prisma.payment.update({ where: { id: paymentId }, data });
  }
}