import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const RECOVERY_CODE_BYTES = 8;
const DEFAULT_RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(count = DEFAULT_RECOVERY_CODE_COUNT): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error('invalid_recovery_code_count');
  }
  return Array.from({ length: count }, () => randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase());
}

export function isRecoveryCode(value: string): boolean {
  return /^[A-F0-9]{16}$/.test(value.toUpperCase());
}

export function hashRecoveryCode(value: string): string {
  return createHash('sha256').update(value.toUpperCase()).digest('hex');
}

/**
 * Atomically consumes one recovery code. Concurrent attempts may both read
 * the unused row, but only one can win the guarded updateMany operation.
 */
export async function consumeRecoveryCode(
  db: PrismaClient,
  userId: string,
  value: string,
  usedAt = new Date(),
): Promise<boolean> {
  if (!isRecoveryCode(value)) return false;
  const codeHash = hashRecoveryCode(value);
  const record = await db.userTwoFactorRecoveryCode.findFirst({
    where: { userId, codeHash, usedAt: null },
    select: { id: true },
  });
  if (!record) return false;

  const consumed = await db.userTwoFactorRecoveryCode.updateMany({
    where: { id: record.id, userId, usedAt: null },
    data: { usedAt },
  });
  return consumed.count === 1;
}
