import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const IDEMPOTENCY_SCOPE_PREFIX = 'merchant:POST:/v1/payments';

export interface CreatePaymentIdempotentlyInput {
  merchantId: string;
  actorUserId: string;
  walletDestinationId: string;
  amountBrlCents: number;
  commissionBps: number;
  description?: string;
  idempotencyKey: string;
  ipAddress: string;
}

export interface PaymentCreationResponse {
  id: string;
  externalId: string;
  status: string;
  amountBrlCents: string;
  pixCopyPaste: string;
  expiresAt: string;
  mode: 'mock';
  warning: string;
}

export type CreatePaymentIdempotentlyResult =
  | { kind: 'created' | 'replayed'; response: PaymentCreationResponse }
  | { kind: 'idempotency_conflict'; error: string }
  | { kind: 'idempotency_in_progress'; error: string }
  | { kind: 'merchant_not_approved'; error: string }
  | { kind: 'wallet_not_found'; error: string }
  | { kind: 'wallet_not_verified'; error: string };

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= 128
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

export function hashPaymentCreationRequest(input: Pick<
  CreatePaymentIdempotentlyInput,
  'walletDestinationId' | 'amountBrlCents' | 'description'
>): string {
  const canonicalRequest = JSON.stringify({
    walletDestinationId: input.walletDestinationId,
    amountBrlCents: Math.trunc(input.amountBrlCents),
    description: input.description?.trim() || null,
  });
  return createHash('sha256').update(canonicalRequest).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function resolveExistingRecord(
  record: { requestHash: string; responseJson: Prisma.JsonValue | null },
  requestHash: string,
): CreatePaymentIdempotentlyResult {
  if (record.requestHash !== requestHash) {
    return { kind: 'idempotency_conflict', error: 'idempotency_key_reused_with_different_request' };
  }
  if (record.responseJson && typeof record.responseJson === 'object' && !Array.isArray(record.responseJson)) {
    return { kind: 'replayed', response: record.responseJson as unknown as PaymentCreationResponse };
  }
  return { kind: 'idempotency_in_progress', error: 'idempotency_request_in_progress' };
}

/**
 * Creates the payment, its idempotency response and its audit event in one
 * PostgreSQL transaction. Concurrent requests with the same merchant/key are
 * serialized by the unique (scope, key) constraint.
 */
export async function createPaymentIdempotently(
  db: PrismaClient,
  input: CreatePaymentIdempotentlyInput,
): Promise<CreatePaymentIdempotentlyResult> {
  if (!isValidIdempotencyKey(input.idempotencyKey)) {
    throw new Error('invalid_idempotency_key');
  }

  const scope = `${IDEMPOTENCY_SCOPE_PREFIX}:${input.merchantId}`;
  const requestHash = hashPaymentCreationRequest(input);

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.idempotencyRecord.findUnique({
        where: { scope_key: { scope, key: input.idempotencyKey } },
      });
      if (existing) return resolveExistingRecord(existing, requestHash);

      const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
      if (!merchant || !merchant.isEnabled || merchant.kycStatus !== 'APPROVED') {
        return { kind: 'merchant_not_approved', error: 'merchant_not_approved' };
      }

      const wallet = await tx.walletDestination.findFirst({
        where: { id: input.walletDestinationId, merchantId: input.merchantId },
      });
      if (!wallet) return { kind: 'wallet_not_found', error: 'wallet_not_found' };
      if (wallet.status !== 'VERIFIED' || !wallet.isVerified) {
        return { kind: 'wallet_not_verified', error: 'wallet_not_verified' };
      }

      const record = await tx.idempotencyRecord.create({
        data: {
          scope,
          key: input.idempotencyKey,
          requestHash,
        },
      });

      const externalId = `pixsplit_${randomUUID()}`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      const payment = await tx.payment.create({
        data: {
          externalId,
          merchantId: input.merchantId,
          walletDestinationId: input.walletDestinationId,
          amountBrlCents: BigInt(input.amountBrlCents),
          description: input.description,
          commissionBps: input.commissionBps,
          pixCopyPaste: `MOCK-PIX-NOT-PAYABLE:${externalId}`,
          expiresAt,
        },
      });

      const response: PaymentCreationResponse = {
        id: payment.id,
        externalId: payment.externalId,
        status: payment.status,
        amountBrlCents: payment.amountBrlCents.toString(),
        pixCopyPaste: payment.pixCopyPaste ?? '',
        expiresAt: payment.expiresAt?.toISOString() ?? expiresAt.toISOString(),
        mode: 'mock',
        warning: 'Modo de demonstração. Este código PIX é fictício e não pode ser pago.',
      };

      await tx.idempotencyRecord.update({
        where: { id: record.id },
        data: { responseJson: response as unknown as Prisma.InputJsonObject },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: input.actorUserId,
          action: 'PAYMENT_CREATED',
          entityType: 'PAYMENT',
          entityId: payment.id,
          ipAddress: input.ipAddress,
          metadata: {
            amountBrlCents: input.amountBrlCents,
            walletDestinationId: input.walletDestinationId,
            idempotencyScope: scope,
          } as Prisma.InputJsonObject,
        },
      });

      return { kind: 'created', response };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // A competing transaction may have won the unique key. Re-read its
    // committed response instead of creating a second payment.
    const existing = await db.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key: input.idempotencyKey } },
    });
    if (!existing) throw error;
    return resolveExistingRecord(existing, requestHash);
  }
}
