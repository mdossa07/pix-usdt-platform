import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, PrismaClient, PaymentStatus, TransferStatus } from '@prisma/client';
import { ReconciliationService } from './reconciliation.js';

type PaymentRow = { id: string; amountBrlCents: bigint };

function fakeDatabase(
  findMany: (args: Prisma.PaymentFindManyArgs) => Promise<PaymentRow[]>,
): Pick<PrismaClient, 'payment'> {
  return {
    payment: { findMany },
  } as unknown as Pick<PrismaClient, 'payment'>;
}

test('reconciliation pages one OR query and enqueues each matching payment once', async () => {
  const payments: PaymentRow[] = Array.from({ length: 5 }, (_, index) => ({
    id: `payment-${index + 1}`,
    amountBrlCents: BigInt((index + 1) * 500),
  }));
  const calls: Prisma.PaymentFindManyArgs[] = [];
  const enqueued: Array<{ id: string; amount: bigint }> = [];

  const prisma = fakeDatabase(async args => {
    calls.push(args);
    const cursorId = args.cursor?.id;
    const cursorIndex = cursorId ? payments.findIndex(payment => payment.id === cursorId) : -1;
    const start = cursorIndex + 1;
    return payments.slice(start, start + Number(args.take ?? 100)) ;
  });

  const service = new ReconciliationService(
    prisma,
    async (id, amount) => { enqueued.push({ id, amount }); },
    () => new Date('2026-11-25T15:00:00.000Z'),
    2,
  );

  const recovered = await service.reconcile();

  assert.equal(recovered, 5);
  assert.deepEqual(enqueued, payments.map(payment => ({ id: payment.id, amount: payment.amountBrlCents })));
  assert.equal(new Set(enqueued.map(item => item.id)).size, 5);
  assert.equal(calls.length, 3, 'five payments should be read in three bounded pages');

  const firstQuery = calls[0];
  assert.equal(firstQuery.take, 2);
  assert.deepEqual(firstQuery.orderBy, { id: 'asc' });
  assert.equal(firstQuery.cursor, undefined);
  assert.equal(firstQuery.skip, undefined);

  assert.deepEqual(calls[1].cursor, { id: 'payment-2' });
  assert.equal(calls[1].skip, 1);
  assert.deepEqual(calls[2].cursor, { id: 'payment-4' });
  assert.equal(calls[2].skip, 1);

  const conditions = firstQuery.where?.OR;
  assert.ok(Array.isArray(conditions));
  assert.equal(conditions.length, 5, 'recovery criteria must be combined in one unique payment query');

  const earlyStale = conditions[0] as Prisma.PaymentWhereInput;
  assert.deepEqual(earlyStale.status, {
    in: [PaymentStatus.PIX_CONFIRMED, PaymentStatus.CONVERSION_PENDING, PaymentStatus.CRYPTO_CREDITED],
  });
  assert.deepEqual(earlyStale.updatedAt, { lt: new Date('2026-11-25T14:55:00.000Z') });

  const merchantProcessing = conditions[1] as Prisma.PaymentWhereInput;
  assert.equal(merchantProcessing.merchantTransferStatus, TransferStatus.PROCESSING);
  assert.deepEqual(merchantProcessing.updatedAt, { lt: new Date('2026-11-25T14:30:00.000Z') });

  const platformProcessing = conditions[2] as Prisma.PaymentWhereInput;
  assert.equal(platformProcessing.platformTransferStatus, TransferStatus.PROCESSING);
  assert.deepEqual(platformProcessing.updatedAt, { lt: new Date('2026-11-25T14:30:00.000Z') });
});

test('overlapping reconciliation timer ticks share one active run', async () => {
  const payment: PaymentRow = { id: 'payment-single-flight', amountBrlCents: 500n };
  let queryCalls = 0;
  let releaseQuery!: (rows: PaymentRow[]) => void;
  const queryGate = new Promise<PaymentRow[]>(resolve => { releaseQuery = resolve; });
  const enqueued: string[] = [];

  const prisma = fakeDatabase(async () => {
    queryCalls++;
    return queryGate;
  });
  const service = new ReconciliationService(
    prisma,
    async id => { enqueued.push(id); },
    () => new Date('2026-11-25T15:00:00.000Z'),
  );

  const firstRun = service.reconcile();
  const overlappingRun = service.reconcile();
  assert.equal(firstRun, overlappingRun, 'a second timer tick must reuse the active promise');

  releaseQuery([payment]);
  assert.equal(await firstRun, 1);
  assert.equal(queryCalls, 1);
  assert.deepEqual(enqueued, [payment.id]);
});

test('a failed enqueue releases the single-flight guard for the next reconciliation run', async () => {
  let enqueueCalls = 0;
  const prisma = fakeDatabase(async () => [
    { id: 'payment-retry', amountBrlCents: 900n },
  ]);
  const service = new ReconciliationService(
    prisma,
    async () => {
      enqueueCalls++;
      if (enqueueCalls === 1) throw new Error('redis_unavailable');
    },
    () => new Date('2026-11-25T15:00:00.000Z'),
  );

  await assert.rejects(service.reconcile(), /redis_unavailable/);
  assert.equal(await service.reconcile(), 1);
  assert.equal(enqueueCalls, 2);
});

test('rejects unsafe reconciliation page sizes', () => {
  const prisma = fakeDatabase(async () => []);
  assert.throws(() => new ReconciliationService(prisma, undefined, undefined, 0), /batch_size/);
  assert.throws(() => new ReconciliationService(prisma, undefined, undefined, 1_001), /batch_size/);
});
