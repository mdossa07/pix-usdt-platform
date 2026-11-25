import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient, TransferStatus } from '@prisma/client';
import { ReconciliationService } from './reconciliation.js';

type Candidate = { id: string; amountBrlCents: bigint };

function makePrisma(
  findMany: (args: unknown) => Promise<Candidate[]>,
): PrismaClient {
  return {
    payment: { findMany },
  } as unknown as PrismaClient;
}

test('reconciliation queries stale SUBMITTED states for both independent payout legs', async () => {
  let query: any;
  const candidate = { id: 'payment-ambiguous-both-legs', amountBrlCents: 12500n };
  const prisma = makePrisma(async args => {
    query = args;
    return [candidate];
  });
  const enqueued: Array<{ id: string; amount: bigint }> = [];
  const service = new ReconciliationService(prisma, async (id, amount) => {
    enqueued.push({ id, amount });
  });

  const recovered = await service.reconcile();

  assert.equal(recovered, 1);
  assert.deepEqual(enqueued, [{ id: candidate.id, amount: 12500n }]);
  assert.equal(query.orderBy.updatedAt, 'asc');

  const branches = query.where.OR as Array<Record<string, any>>;
  const merchantSubmitted = branches.find(branch => branch.merchantTransferStatus === TransferStatus.SUBMITTED);
  const platformSubmitted = branches.find(branch => branch.platformTransferStatus === TransferStatus.SUBMITTED);
  assert.ok(merchantSubmitted, 'merchant SUBMITTED leg must be eligible for status reconciliation');
  assert.ok(platformSubmitted, 'platform SUBMITTED leg must be eligible for status reconciliation');

  for (const branch of [merchantSubmitted, platformSubmitted]) {
    const threshold = branch.updatedAt.lt as Date;
    assert.ok(threshold instanceof Date);
    const ageMs = Date.now() - threshold.getTime();
    assert.ok(ageMs >= 29 * 60 * 1000 && ageMs <= 31 * 60 * 1000, 'SUBMITTED recovery must wait approximately 30 minutes');
  }
});

test('reconciliation defensively enqueues a payment only once per cycle', async () => {
  const duplicate = { id: 'payment-duplicated-in-query', amountBrlCents: 1000n };
  const prisma = makePrisma(async () => [duplicate, duplicate]);
  const enqueued: string[] = [];
  const service = new ReconciliationService(prisma, async id => { enqueued.push(id); });

  const recovered = await service.reconcile();

  assert.equal(recovered, 1);
  assert.deepEqual(enqueued, [duplicate.id]);
});

test('overlapping reconciliation calls do not run a second queue pass in the same process', async () => {
  let releaseEnqueue!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const gate = new Promise<void>(resolve => { releaseEnqueue = resolve; });
  const prisma = makePrisma(async () => [{ id: 'payment-single-flight', amountBrlCents: 5000n }]);
  const service = new ReconciliationService(prisma, async () => {
    signalStarted();
    await gate;
  });

  const first = service.reconcile();
  await started;
  const overlapping = await service.reconcile();
  releaseEnqueue();

  assert.equal(overlapping, 0);
  assert.equal(await first, 1);
});

test('a queue error releases the single-flight guard so the next cycle can retry', async () => {
  let shouldFail = true;
  let calls = 0;
  const prisma = makePrisma(async () => [{ id: 'payment-retry-after-queue-error', amountBrlCents: 8000n }]);
  const service = new ReconciliationService(prisma, async () => {
    calls++;
    if (shouldFail) throw new Error('redis_unavailable');
  });

  await assert.rejects(service.reconcile(), /redis_unavailable/);
  shouldFail = false;

  assert.equal(await service.reconcile(), 1);
  assert.equal(calls, 2);
});

test('reconciliation reports zero when no stale payments are found', async () => {
  const prisma = makePrisma(async () => []);
  let enqueueCalls = 0;
  const service = new ReconciliationService(prisma, async () => { enqueueCalls++; });

  assert.equal(await service.reconcile(), 0);
  assert.equal(enqueueCalls, 0);
});
