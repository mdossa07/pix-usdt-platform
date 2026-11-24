import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAuthSessionActive } from './session-store.js';

const databaseUrl = new URL(process.env.DATABASE_URL!);
databaseUrl.searchParams.set('schema', 'auth_session_test');
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
const suffix = randomUUID().replace(/-/g, '');
let userId = '';
let otherUserId = '';

describe('persisted authentication session revocation', () => {
  beforeAll(async () => {
    const [user, otherUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: `auth-session-${suffix}@example.invalid`,
          passwordHash: 'test-only-not-a-real-password-hash',
          fullName: 'Auth Session Test',
        },
      }),
      prisma.user.create({
        data: {
          email: `auth-session-other-${suffix}@example.invalid`,
          passwordHash: 'test-only-not-a-real-password-hash',
          fullName: 'Other Auth Session Test',
        },
      }),
    ]);
    userId = user.id;
    otherUserId = otherUser.id;
  }, 20_000);

  afterAll(async () => {
    if (userId || otherUserId) {
      await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
    }
    await prisma.$disconnect();
  }, 20_000);

  it('persists a JTI and rejects it immediately after current-session logout', async () => {
    const jti = randomUUID();
    const session = await prisma.authSession.create({
      data: {
        jti,
        userId,
        expiresAt: new Date(Date.now() + 60_000),
        ipAddress: '127.0.0.1',
        userAgent: 'PixSplit auth-session integration test',
      },
    });

    const stored = await prisma.authSession.findUniqueOrThrow({ where: { jti } });
    expect(isAuthSessionActive(stored, userId)).toBe(true);

    const revoked = await prisma.authSession.updateMany({
      where: { jti, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    expect(revoked.count).toBe(1);

    const reread = await prisma.authSession.findUniqueOrThrow({ where: { jti } });
    expect(isAuthSessionActive(reread, userId)).toBe(false);
    expect((await prisma.authSession.updateMany({
      where: { jti, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })).count).toBe(0);
    expect(session.userId).toBe(userId);
  }, 20_000);

  it('revokes only the authenticated user sessions during logout-all', async () => {
    const ownJtis = [randomUUID(), randomUUID()];
    const otherJti = randomUUID();
    await prisma.authSession.createMany({
      data: [
        ...ownJtis.map(jti => ({ jti, userId, expiresAt: new Date(Date.now() + 60_000) })),
        { jti: otherJti, userId: otherUserId, expiresAt: new Date(Date.now() + 60_000) },
      ],
    });

    const result = await prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    expect(result.count).toBe(2);

    const ownSessions = await prisma.authSession.findMany({ where: { jti: { in: ownJtis } } });
    expect(ownSessions.every(session => !isAuthSessionActive(session, userId))).toBe(true);

    const otherSession = await prisma.authSession.findUniqueOrThrow({ where: { jti: otherJti } });
    expect(isAuthSessionActive(otherSession, otherUserId)).toBe(true);
  }, 20_000);

  it('does not let one user locate or revoke another user session', async () => {
    const jti = randomUUID();
    const foreignSession = await prisma.authSession.create({
      data: { jti, userId: otherUserId, expiresAt: new Date(Date.now() + 60_000) },
    });

    const target = await prisma.authSession.findFirst({
      where: { id: foreignSession.id, userId, revokedAt: null },
      select: { id: true, jti: true },
    });
    expect(target).toBeNull();

    const revoked = await prisma.authSession.updateMany({
      where: { id: foreignSession.id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    expect(revoked.count).toBe(0);

    const stillActive = await prisma.authSession.findUniqueOrThrow({ where: { jti } });
    expect(isAuthSessionActive(stillActive, otherUserId)).toBe(true);
  }, 20_000);
});
