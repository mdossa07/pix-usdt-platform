import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consumeRecoveryCode, hashRecoveryCode } from './two-factor-recovery.js';

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, '');
let userId = '';

describe('admin TOTP recovery code consumption', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `totp-recovery-${suffix}@example.invalid`,
        passwordHash: 'test-only-not-a-real-password-hash',
        fullName: 'TOTP Recovery Test',
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });
    userId = user.id;
  }, 20_000);

  afterAll(async () => {
    if (userId) {
      await prisma.userTwoFactorRecoveryCode.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  }, 20_000);

  it('allows exactly one winner when the same recovery code is submitted concurrently', async () => {
    const rawCode = '0123456789ABCDEF';
    await prisma.userTwoFactorRecoveryCode.create({
      data: { userId, codeHash: hashRecoveryCode(rawCode) },
    });

    const results = await Promise.all([
      consumeRecoveryCode(prisma, userId, rawCode),
      consumeRecoveryCode(prisma, userId, rawCode),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(value => !value)).toHaveLength(1);
    expect(await consumeRecoveryCode(prisma, userId, rawCode)).toBe(false);
  }, 20_000);

  it('does not consume an unknown code', async () => {
    expect(await consumeRecoveryCode(prisma, userId, 'FFFFFFFFFFFFFFFF')).toBe(false);
  });
});
