import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PrismaClient, PaymentStatus } from '@prisma/client';
import { ReconciliationService } from './reconciliation.js';

describe('ReconciliationService — PostgreSQL advisory lock', () => {
  it('coordinates independent API clients and releases the lock after commit', async () => {
    const firstPrisma = new PrismaClient();
    const secondPrisma = new PrismaClient();

    let userId: string | undefined;
    let merchantId: string | undefined;
    let walletId: string | undefined;
    let paymentId: string | undefined;

    let signalEnqueueStarted!: () => void;
    let releaseEnqueue!: () => void;
    const enqueueStarted = new Promise<void>((resolve) => {
      signalEnqueueStarted = resolve;
    });
    const enqueueGate = new Promise<void>((resolve) => {
      releaseEnqueue = resolve;
    });

    let firstRun: Promise<number> | undefined;

    try {
      const suffix = randomUUID();
      const user = await firstPrisma.user.create({
        data: {
          email: `reconciliation-${suffix}@example.test`,
          passwordHash: 'integration-test-only',
          fullName: 'Reconciliation Integration Test',
        },
      });
      userId = user.id;

      const merchant = await firstPrisma.merchant.create({
        data: {
          userId: user.id,
          merchantType: 'COMPANY',
          legalName: 'Reconciliation Integration Test Ltda',
          taxIdEncrypted: 'integration-test-only',
          taxIdLast4: '0001',
        },
      });
      merchantId = merchant.id;

      const wallet = await firstPrisma.walletDestination.create({
        data: {
          merchantId: merchant.id,
          label: 'Integration test wallet',
          exchangeName: 'Test provider',
          networkCode: 'TRON',
          addressEncrypted: 'integration-test-only',
          addressLast8: '12345678',
          holderName: 'Reconciliation Integration Test Ltda',
        },
      });
      walletId = wallet.id;

      const payment = await firstPrisma.payment.create({
        data: {
          externalId: `reconciliation-${suffix}`,
          merchantId: merchant.id,
          walletDestinationId: wallet.id,
          status: PaymentStatus.PIX_CONFIRMED,
          amountBrlCents: 5000n,
        },
      });
      paymentId = payment.id;

      await firstPrisma.$executeRaw`
        UPDATE "Payment"
        SET "updatedAt" = NOW() - INTERVAL '10 minutes'
        WHERE "id" = ${payment.id}
      `;

      const firstService = new ReconciliationService(firstPrisma, async () => {
        signalEnqueueStarted();
        await enqueueGate;
      });

      let secondEnqueueCount = 0;
      const secondService = new ReconciliationService(secondPrisma, async () => {
        secondEnqueueCount += 1;
      });

      firstRun = firstService.reconcile();

      // Fail fast if the first client cannot reach the enqueuer (and therefore
      // never holds the transaction-scoped advisory lock for this scenario).
      await Promise.race([
        enqueueStarted,
        firstRun.then(() => {
          throw new Error('First reconciliation finished before acquiring its lock and enqueuing');
        }),
      ]);

      // A different PrismaClient uses a separate PostgreSQL connection. It must
      // observe the transaction-scoped advisory lock and skip the same batch.
      expect(await secondService.reconcile()).toBe(0);
      expect(secondEnqueueCount).toBe(0);

      // Committing the first transaction releases the PostgreSQL advisory lock.
      releaseEnqueue();
      expect(await firstRun).toBe(1);

      // The second client can now acquire the lock and process the stale payment.
      expect(await secondService.reconcile()).toBe(1);
      expect(secondEnqueueCount).toBe(1);
    } finally {
      releaseEnqueue();
      if (firstRun) await firstRun.catch(() => undefined);

      if (paymentId) {
        await firstPrisma.payment.deleteMany({ where: { id: paymentId } });
      }
      if (walletId) {
        await firstPrisma.walletDestination.deleteMany({ where: { id: walletId } });
      }
      if (merchantId) {
        await firstPrisma.merchant.deleteMany({ where: { id: merchantId } });
      }
      if (userId) {
        await firstPrisma.user.deleteMany({ where: { id: userId } });
      }

      await Promise.all([firstPrisma.$disconnect(), secondPrisma.$disconnect()]);
    }
  });
});
