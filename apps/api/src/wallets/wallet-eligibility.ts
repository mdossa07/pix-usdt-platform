export type WalletVerificationStatus =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'DISABLED';

/**
 * A wallet may be selected for future payment destinations only after both
 * persisted verification indicators agree. This intentionally fails closed.
 */
export function canBeDefaultDestination(
  status: WalletVerificationStatus,
  isVerified: boolean,
): boolean {
  return status === 'VERIFIED' && isVerified;
}
