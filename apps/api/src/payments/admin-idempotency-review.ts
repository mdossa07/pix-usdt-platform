import { Prisma, PrismaClient } from '@prisma/client';
import { MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE } from './merchant-payment-idempotency.js';

export const MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS = 2 * 60 * 1000;
const MAX_PENDING_RESERVATIONS = 100;

type ReviewDatabase = Pick<PrismaClient, 'idempotencyRecord' | 'merchant' | '$transaction'>;

export interface PendingMerchantPaymentReservation {
  id: string;
  externalId: string;
  merchantId: string | null;
  merchantName: string | null;
  merchantEmail: string | null;
  amountBrlCents: string | null;
  walletDestinationId: string | null;
  createdAt: Date;
  lastReviewedAt: Date | null;
  reviewNote: string | null;
}

/**
 * Lists only old, unresolved merchant-payment reservations. The grace period
 * avoids showing normal in-flight requests as operator incidents.
 *
 * Legacy reservations created before the metadata migration remain visible,
 * but are labelled as legacy because merchant/amount metadata is unavailable.
 */
export async function listPendingMerchantPaymentReservations(
  db: ReviewDatabase,
  now = new Date(),
): Promise<PendingMerchantPaymentReservation[]> {
  const staleBefore = new Date(now.getTime() - MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS);
  const records = await db.idempotencyRecord.findMany({
    where: {
      scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
      responseJson: { equals: Prisma.DbNull },
      createdAt: { lt: staleBefore },
      lastReviewedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_PENDING_RESERVATIONS,
    select: {
      id: true,
      key: true,
      merchantId: true,
      amountBrlCents: true,
      walletDestinationId: true,
      createdAt: true,
      lastReviewedAt: true,
      reviewNote: true,
    },
  });

  const merchantIds = [...new Set(records.flatMap(record => record.merchantId ? [record.merchantId] : []))];
  const merchants = merchantIds.length
    ? await db.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: {
        id: true,
        legalName: true,
        user: { select: { email: true } },
      },
    })
    : [];
  const merchantById = new Map(merchants.map(merchant => [merchant.id, merchant]));

  return records.map(record => {
    const merchant = record.merchantId ? merchantById.get(record.merchantId) : undefined;
    return {
      id: record.id,
      externalId: record.key,
      merchantId: record.merchantId,
      merchantName: merchant?.legalName ?? null,
      merchantEmail: merchant?.user.email ?? null,
      amountBrlCents: record.amountBrlCents?.toString() ?? null,
      walletDestinationId: record.walletDestinationId,
      createdAt: record.createdAt,
      lastReviewedAt: record.lastReviewedAt,
      reviewNote: record.reviewNote,
    };
  });
}

/**
 * Records an operator's manual review without resolving or deleting the
 * reservation. A note is audit metadata only; it never authorizes a retry.
 */
export async function recordMerchantPaymentReservationReview(
  db: ReviewDatabase,
  input: {
    reservationId: string;
    actorUserId: string;
    ipAddress: string;
    note: string;
  },
  now = new Date(),
): Promise<boolean> {
  const note = input.note.trim();
  if (note.length < 10 || note.length > 1000) throw new Error('invalid_review_note');

  const staleBefore = new Date(now.getTime() - MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS);
  return db.$transaction(async tx => {
    const updated = await tx.idempotencyRecord.updateMany({
      where: {
        id: input.reservationId,
        scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
        responseJson: { equals: Prisma.DbNull },
        createdAt: { lt: staleBefore },
        lastReviewedAt: null,
      },
      data: {
        lastReviewedAt: now,
        lastReviewedByUserId: input.actorUserId,
        reviewNote: note,
      },
    });
    if (updated.count !== 1) return false;

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'MERCHANT_PAYMENT_RESERVATION_REVIEWED',
        entityType: 'IDEMPOTENCY_RECORD',
        entityId: input.reservationId,
        ipAddress: input.ipAddress,
        metadata: {
          reviewNote: note,
          reservationRemainsLocked: true,
        } as Prisma.InputJsonObject,
      },
    });
    return true;
  });
}
