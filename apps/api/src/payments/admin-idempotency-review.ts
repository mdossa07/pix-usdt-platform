import { Prisma, PrismaClient } from '@prisma/client';
import { MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE } from './merchant-payment-idempotency.js';

export const MERCHANT_PAYMENT_RESERVATION_REVIEW_DELAY_MS = 2 * 60 * 1000;
const MAX_PENDING_RESERVATIONS = 100;

type ReviewDatabase = Pick<PrismaClient, 'idempotencyRecord' | 'merchant' | '$transaction'>;

export const SENSITIVE_REVIEW_NOTE_ERROR = 'sensitive_review_note';

function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || /^([0-9])\1{10}$/.test(digits)) return false;
  const numbers = digits.split('').map(Number);
  const firstSum = numbers.slice(0, 9).reduce((sum, digit, index) => sum + digit * (10 - index), 0);
  const firstCheck = firstSum % 11 < 2 ? 0 : 11 - (firstSum % 11);
  if (numbers[9] !== firstCheck) return false;
  const secondSum = numbers.slice(0, 10).reduce((sum, digit, index) => sum + digit * (11 - index), 0);
  const secondCheck = secondSum % 11 < 2 ? 0 : 11 - (secondSum % 11);
  return numbers[10] === secondCheck;
}

/** Detect common personal identifiers and credentials before a free-text audit note is persisted. */
export function containsSensitiveMerchantPaymentReviewNote(note: string): boolean {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(note)) return true;
  if (/\b(?:CPF|CNPJ)\s*[:=]/i.test(note)) return true;
  if (/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(note)) return true;
  if (/(?:\+?55\s*)?\(\d{2}\)\s*9?\d{4}-\d{4}/.test(note)) return true;
  if (/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/i.test(note)) return true;
  if (/\bpsk_[A-Za-z0-9_-]{16,}\b/i.test(note)) return true;
  if (/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|secret|senha|password)\s*[:=]\s*[^\s,;]{8,}/i.test(note)) return true;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(note)) return true;

  const cpfCandidates = note.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) ?? [];
  return cpfCandidates.some(isValidCpf);
}


export interface PendingMerchantPaymentReservation {
  id: string;
  externalId: string;
  merchantName: string | null;
  amountBrlCents: string | null;
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
      },
    })
    : [];
  const merchantById = new Map(merchants.map(merchant => [merchant.id, merchant]));

  return records.map(record => {
    const merchant = record.merchantId ? merchantById.get(record.merchantId) : undefined;
    return {
      id: record.id,
      externalId: record.key,
      merchantName: merchant?.legalName ?? null,
      amountBrlCents: record.amountBrlCents?.toString() ?? null,
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
  if (containsSensitiveMerchantPaymentReviewNote(note)) throw new Error(SENSITIVE_REVIEW_NOTE_ERROR);

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
