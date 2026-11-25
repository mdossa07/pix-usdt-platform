import { createHmac } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

export const MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE = 'merchant:POST:/v1/merchant/payments';

export interface MerchantPaymentRequestFingerprint {
  merchantId: string;
  externalId: string;
  amountBrlCents: number;
  walletDestinationId: string;
  payerName?: string;
  payerTaxId?: string;
  description?: string;
}

export type MerchantPaymentIdempotencyResult =
  | { kind: 'reserved'; requestHash: string }
  | { kind: 'replayed'; response: Prisma.JsonObject }
  | { kind: 'conflict' }
  | { kind: 'in_progress'; requestHash: string };

function canonicalize(input: MerchantPaymentRequestFingerprint): string {
  return JSON.stringify({
    merchantId: input.merchantId,
    externalId: input.externalId,
    amountBrlCents: input.amountBrlCents,
    walletDestinationId: input.walletDestinationId,
    payerName: input.payerName?.trim() || null,
    payerTaxId: input.payerTaxId?.trim() || null,
    description: input.description?.trim() || null,
  });
}

/**
 * Produces a keyed fingerprint so low-entropy personal data such as CPF cannot
 * be recovered by guessing against a plain, database-visible SHA-256 digest.
 * A domain-separated subkey is derived from the application's PII key.
 */
export function hashMerchantPaymentRequest(
  input: MerchantPaymentRequestFingerprint,
  piiEncryptionKeyHex: string,
): string {
  const rootKey = Buffer.from(piiEncryptionKeyHex, 'hex');
  if (rootKey.length !== 32) throw new Error('invalid_pii_encryption_key');
  const fingerprintKey = createHmac('sha256', rootKey)
    .update('pixsplit:merchant-payment-idempotency:v1')
    .digest();
  return createHmac('sha256', fingerprintKey)
    .update(canonicalize(input))
    .digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveExisting(
  record: { requestHash: string; responseJson: Prisma.JsonValue | null },
  requestHash: string,
): MerchantPaymentIdempotencyResult {
  if (record.requestHash !== requestHash) return { kind: 'conflict' };
  if (isJsonObject(record.responseJson)) return { kind: 'replayed', response: record.responseJson };
  return { kind: 'in_progress', requestHash };
}

/**
 * Reserves a merchant/externalId pair before calling the payment provider.
 * The unique (scope, key) constraint serializes concurrent attempts across API
 * replicas. An unresolved reservation is deliberately fail-closed: after an
 * ambiguous provider outcome, the same key is not submitted again automatically.
 */
export async function reserveMerchantPaymentIdempotency(
  db: PrismaClient,
  input: MerchantPaymentRequestFingerprint,
  piiEncryptionKeyHex: string,
): Promise<MerchantPaymentIdempotencyResult> {
  const requestHash = hashMerchantPaymentRequest(input, piiEncryptionKeyHex);
  const where = {
    scope_key: {
      scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
      key: input.externalId,
    },
  };

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.idempotencyRecord.findUnique({ where });
      if (existing) return resolveExisting(existing, requestHash);

      await tx.idempotencyRecord.create({
        data: {
          scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
          key: input.externalId,
          requestHash,
        },
      });
      return { kind: 'reserved', requestHash };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // A concurrent API instance may have inserted the same reservation first.
    const existing = await db.idempotencyRecord.findUnique({ where });
    if (!existing) throw error;
    return resolveExisting(existing, requestHash);
  }
}

/**
 * Stores the provider result and the payment response in the same transaction
 * as the Payment row. Returns false when another request already completed
 * the reservation or the reservation no longer matches.
 */
export async function completeMerchantPaymentIdempotency(
  tx: Prisma.TransactionClient,
  externalId: string,
  requestHash: string,
  response: Prisma.InputJsonObject,
): Promise<void> {
  const result = await tx.idempotencyRecord.updateMany({
    where: {
      scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
      key: externalId,
      requestHash,
      responseJson: { equals: Prisma.DbNull },
    },
    data: { responseJson: response },
  });
  if (result.count !== 1) throw new Error('merchant_payment_idempotency_reservation_lost');
}
