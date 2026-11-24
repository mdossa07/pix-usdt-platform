import { PaymentStatus, TransferStatus } from '@prisma/client';

/**
 * Derives the aggregate payment state only from the two independent payout legs.
 * Unknown/submitted attempts are deliberately kept under review, never treated as
 * ordinary pending or completed transfers.
 */
export function derivePaymentAggregateStatus(
  merchant: TransferStatus | null | undefined,
  platform: TransferStatus | null | undefined,
): PaymentStatus {
  if (merchant === TransferStatus.COMPLETED && platform === TransferStatus.COMPLETED) {
    return PaymentStatus.COMPLETED;
  }
  if (merchant === TransferStatus.FAILED || platform === TransferStatus.FAILED) {
    return PaymentStatus.UNDER_REVIEW;
  }
  if (
    merchant === TransferStatus.SUBMITTED || merchant === TransferStatus.CREATED
    || platform === TransferStatus.SUBMITTED || platform === TransferStatus.CREATED
  ) {
    return PaymentStatus.UNDER_REVIEW;
  }
  if (merchant === TransferStatus.COMPLETED) return PaymentStatus.PLATFORM_PAYOUT_PENDING;
  if (platform === TransferStatus.COMPLETED) return PaymentStatus.MERCHANT_PAYOUT_PENDING;
  return PaymentStatus.COMMISSION_TRANSFER_PENDING;
}
