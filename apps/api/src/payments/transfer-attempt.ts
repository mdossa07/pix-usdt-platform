import type { TransferKind } from '@prisma/client';

/**
 * Stable provider reference for one payout attempt.
 * A confirmed terminal failure gets a new attempt number; ambiguous outcomes
 * must keep the same number so provider-side idempotency can return the same order.
 */
export function transferAttemptIdempotencyKey(
  paymentId: string,
  kind: TransferKind,
  attemptNumber: number,
): string {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error('attempt_number_must_be_positive_integer');
  }
  const leg = kind === 'MERCHANT_PAYOUT' ? 'merchant' : 'platform';
  return `${paymentId}:${leg}:v${attemptNumber}`;
}
