import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  listPendingMerchantPaymentReservations,
  recordMerchantPaymentReservationReview,
  MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS,
} from './admin-idempotency-review.js';
import { MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE } from './merchant-payment-idempotency.js';

function fakeDatabase(options: {
  records?: Array<Record<string, unknown>>;
  merchants?: Array<Record<string, unknown>>;
  updateCount?: number;
}) {
  const calls: { findMany?: unknown; updateMany?: unknown; audit?: unknown } = {};
  const records = options.records ?? [];
  const tx = {
    idempotencyRecord: {
      updateMany: async (args: unknown) => {
        calls.updateMany = args;
        return { count: options.updateCount ?? 1 };
      },
    },
    auditEvent: {
      create: async (args: unknown) => { calls.audit = args; return args; },
    },
  };
  const db = {
    idempotencyRecord: {
      findMany: async (args: unknown) => { calls.findMany = args; return records; },
    },
    merchant: {
      findMany: async () => options.merchants ?? [],
    },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaClient;
  return { db, calls };
}

test('pending reservation list is scoped, old-only, unresolved-only and enriched without PII', async () => {
  const now = new Date('2026-11-25T18:00:00.000Z');
  const createdAt = new Date(now.getTime() - MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS - 1000);
  const fake = fakeDatabase({
    records: [{
      id: 'reservation-1',
      key: 'merchant-external-123',
      merchantId: 'merchant-1',
      amountBrlCents: 12500n,
      walletDestinationId: 'wallet-1',
      createdAt,
      lastReviewedAt: null,
      reviewNote: null,
    }],
    merchants: [{
      id: 'merchant-1',
      legalName: 'Merchant Example',
      user: { email: 'merchant@example.test' },
    }],
  });

  const result = await listPendingMerchantPaymentReservations(fake.db, now);
  const query = fake.calls.findMany as { where: Record<string, unknown>; take: number };
  assert.equal(query.take, 100);
  assert.equal(query.where.scope, MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE);
  assert.deepEqual(query.where.responseJson, { equals: Prisma.DbNull });
  assert.deepEqual(query.where.createdAt, {
    lt: new Date(now.getTime() - MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS),
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    id: 'reservation-1',
    externalId: 'merchant-external-123',
    merchantId: 'merchant-1',
    merchantName: 'Merchant Example',
    merchantEmail: 'merchant@example.test',
    amountBrlCents: '12500',
    walletDestinationId: 'wallet-1',
    createdAt,
    lastReviewedAt: null,
    reviewNote: null,
  });
});

test('manual review is audited and keeps the reservation unresolved', async () => {
  const now = new Date('2026-11-25T18:00:00.000Z');
  const fake = fakeDatabase({ updateCount: 1 });
  const reviewed = await recordMerchantPaymentReservationReview(fake.db, {
    reservationId: 'reservation-1',
    actorUserId: 'admin-1',
    ipAddress: '127.0.0.1',
    note: 'Provider portal checked; result still pending.',
  }, now);

  assert.equal(reviewed, true);
  const update = fake.calls.updateMany as { where: Record<string, unknown>; data: Record<string, unknown> };
  assert.equal(update.where.id, 'reservation-1');
  assert.equal(update.where.scope, MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE);
  assert.deepEqual(update.where.responseJson, { equals: Prisma.DbNull });
  assert.equal(update.data.lastReviewedByUserId, 'admin-1');
  assert.equal(update.data.lastReviewedAt, now);
  assert.equal(update.data.reviewNote, 'Provider portal checked; result still pending.');

  const audit = fake.calls.audit as { data: { action: string; entityId: string; metadata: Record<string, unknown> } };
  assert.equal(audit.data.action, 'MERCHANT_PAYMENT_RESERVATION_REVIEWED');
  assert.equal(audit.data.entityId, 'reservation-1');
  assert.equal(audit.data.metadata.reservationRemainsLocked, true);
});

test('review cannot alter a completed, recent or non-existent reservation', async () => {
  const fake = fakeDatabase({ updateCount: 0 });
  const result = await recordMerchantPaymentReservationReview(fake.db, {
    reservationId: 'already-completed',
    actorUserId: 'admin-1',
    ipAddress: '127.0.0.1',
    note: 'Checked provider record; closed.',
  });
  assert.equal(result, false);
  assert.equal(fake.calls.audit, undefined);
});

test('review note must be meaningful and bounded', async () => {
  const fake = fakeDatabase({});
  await assert.rejects(
    recordMerchantPaymentReservationReview(fake.db, {
      reservationId: 'reservation-1',
      actorUserId: 'admin-1',
      ipAddress: '127.0.0.1',
      note: '  short  ',
    }),
    /invalid_review_note/,
  );
  assert.equal(fake.calls.updateMany, undefined);
});
