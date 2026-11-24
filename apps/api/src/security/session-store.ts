export interface AuthSessionSnapshot {
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * An authenticated JWT is accepted only while its server-side session exists,
 * belongs to the same user, has not been revoked, and has not expired.
 */
export function isAuthSessionActive(
  session: AuthSessionSnapshot | null | undefined,
  expectedUserId: string,
  now: Date = new Date(),
): boolean {
  if (!session || !expectedUserId || session.userId !== expectedUserId || session.revokedAt !== null) {
    return false;
  }
  if (!(session.expiresAt instanceof Date) || !Number.isFinite(session.expiresAt.getTime())) {
    return false;
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  return session.expiresAt.getTime() > now.getTime();
}
