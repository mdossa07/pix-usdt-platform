import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listPendingMerchantPaymentReservations,
  recordMerchantPaymentReservationReview,
  MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS,
} from './admin-idempotency-review.js';
import { MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE } from './merchant-payment-idempotency.js';

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, '');
const keyPrefix = `reservation-review-${suffix}`;
let merchantId: string;
let merchantUserId: string;
let adminUserId: string;
let reservationIds: string[] = [];

afterAll(async () => {
  if (reservationIds.length) {
    await prisma.auditEvent.deleteMany({ where: { entityType: 'IDEMPOTENCY_RECORD', entityId: { in: reservationIds } } });
  }
  await prisma.idempotencyRecord.deleteMany({
    where: { scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE, key: { startsWith: keyPrefix } },
  });
  if (merchantId) await prisma.merchant.deleteMany({ where: { id: merchantId } });
  const userIds = [merchantUserId, adminUserId].filter(Boolean);
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}, 20_000);

describe('admin merchant payment reservation review queue', () => {
  it('lists stale unresolved reservations and records review without unlocking them', async () => {
    const admin = await prisma.user.create({
      data: {
        email: `reservation-admin-${suffix}@pixsplit.test`,
        passwordHash: 'not-used-by-this-test',
        fullName: 'Reservation Review Admin',
        role: 'SUPER_ADMIN',
      },
    });
    adminUserId = admin.id;

    const merchantUser = await prisma.user.create({
      data: {
        email: `reservation-merchant-${suffix}@pixsplit.test`,
        passwordHash: 'not-used-by-this-test',
        fullName: 'Reservation Review Merchant',
        role: 'MERCHANT',
      },
    });
    merchantUserId = merchantUser.id;

    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        merchantType: 'COMPANY',
        legalName: 'Reservation Review Test Merchant',
        taxIdEncrypted: 'test-only-encrypted-tax-id',
        taxIdLast4: '4321',
        kycStatus: 'APPROVED',
        isEnabled: true,
      },
    });
    merchantId = merchant.id;

    const now = new Date();
    const oldCreatedAt = new Date(now.getTime() - MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS - 60_000);
    const recentCreatedAt = new Date(now.getTime() - 30_000);

    const stale = await prisma.idempotencyRecord.create({
      data: {
        scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
        key: `${keyPrefix}-stale`,
        requestHash: 'a'.repeat(64),
        merchantId,
        amountBrlCents: 12500n,
        walletDestinationId: 'wallet-review-test',
        createdAt: oldCreatedAt,
      },
    });
    reservationIds.push(stale.id);

    const recent = await prisma.idempotencyRecord.create({
      data: {
        scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
        key: `${keyPrefix}-recent`,
        requestHash: 'b'.repeat(64),
        merchantId,
        amountBrlCents: 9900n,
        walletDestinationId: 'wallet-review-test',
        createdAt: recentCreatedAt,
      },
    });
    reservationIds.push(recent.id);

    const completed = await prisma.idempotencyRecord.create({
      data: {
        scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
        key: `${keyPrefix}-completed`,
        requestHash: 'c'.repeat(64),
        merchantId,
        amountBrlCents: 15000n,
        walletDestinationId: 'wallet-review-test',
        responseJson: { paymentId: 'already-completed' },
        createdAt: oldCreatedAt,
      },
    });
    reservationIds.push(completed.id);

    const queue = await listPendingMerchantPaymentReservations(prisma, now);
    expect(queue.map(item => item.id)).toContain(stale.id);
    expect(queue.map(item => item.id)).not.toContain(recent.id);
    expect(queue.map(item => item.id)).not.toContain(completed.id);
    const listed = queue.find(item => item.id === stale.id);
    expect(listed).toMatchObject({
      externalId: `${keyPrefix}-stale`,
      merchantId,
      merchantName: merchant.legalName,
      merchantEmail: merchantUser.email,
      amountBrlCents: '12500',
      walletDestinationId: 'wallet-review-test',
    });

    const reviewed = await recordMerchantPaymentReservationReview(prisma, {
      reservationId: stale.id,
      actorUserId: admin.id,
      ipAddress: '127.0.0.1',
      note: 'Provider portal checked; payment outcome is still pending.',
    });
    expect(reviewed).toBe(true);

    const persisted = await prisma.idempotencyRecord.findUniqueOrThrow({ where: { id: stale.id } });
    expect(persisted.responseJson).toBeNull();
    expect(persisted.lastReviewedByUserId).toBe(admin.id);
    expect(persisted.lastReviewedAt).toBeInstanceOf(Date);
    expect(persisted.reviewNote).toBe('Provider portal checked; payment outcome is still pending.');

    const audit = await prisma.auditEvent.findFirst({
      where: {
        actorUserId: admin.id,
        action: 'MERCHANT_PAYMENT_RESERVATION_REVIEWED',
        entityType: 'IDEMPOTENCY_RECORD',
        entityId: stale.id,
      },
    });
    expect(audit).not.toBeNull();

    const stillLocked = await listPendingMerchantPaymentReservations(prisma, new Date(now.getTime() + 1));
    expect(stillLocked.map(item => item.id)).toContain(stale.id);
    expect(stillLocked.find(item => item.id === stale.id)?.reviewNote).toContain('Provider portal checked');
  }, 20_000);
});
