import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  completeMerchantPaymentIdempotency,
  reserveMerchantPaymentIdempotency,
  MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
} from './merchant-payment-idempotency.js';
import { decryptPii } from '../security/crypto.js';

type MerchantAuthRequest = FastifyRequest & {
  merchant?: { merchantId: string; keyId: string };
  merchantPaymentReservation?: { externalId: string; requestHash: string };
};

type MerchantPaymentBody = {
  amountBrlCents?: unknown;
  walletDestinationId?: unknown;
  externalId?: unknown;
  payerName?: unknown;
  payerTaxId?: unknown;
  description?: unknown;
};

function validBodyForFingerprint(body: MerchantPaymentBody): body is MerchantPaymentBody & {
  amountBrlCents: number;
  walletDestinationId: string;
  externalId: string;
} {
  return typeof body.amountBrlCents === 'number'
    && Number.isSafeInteger(body.amountBrlCents)
    && body.amountBrlCents >= 500
    && body.amountBrlCents <= 10_000_000
    && typeof body.walletDestinationId === 'string'
    && body.walletDestinationId.length > 0
    && typeof body.externalId === 'string'
    && body.externalId.length >= 1
    && body.externalId.length <= 128
    && (body.payerName === undefined || (typeof body.payerName === 'string' && body.payerName.length >= 1 && body.payerName.length <= 200))
    && (body.payerTaxId === undefined || (typeof body.payerTaxId === 'string' && body.payerTaxId.length >= 1 && body.payerTaxId.length <= 64))
    && (body.description === undefined || (typeof body.description === 'string' && body.description.length <= 500));
}

function isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createMerchantPaymentIdempotencyHooks(
  db: PrismaClient,
  piiEncryptionKeyHex: string,
  enabled = true,
) {
  const preHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!enabled) {
      reply.code(503).send({ error: 'financial_operations_disabled' });
      return;
    }
    const authenticated = request as MerchantAuthRequest;
    const merchant = authenticated.merchant;
    const body = request.body as MerchantPaymentBody | null;
    if (!merchant || !body || !validBodyForFingerprint(body)) return;

    const merchantRecord = await db.merchant.findUnique({ where: { id: merchant.merchantId } });
    if (!merchantRecord?.isEnabled || merchantRecord.kycStatus !== 'APPROVED') {
      reply.code(403).send({ error: 'merchant_not_approved' });
      return;
    }
    const wallet = await db.walletDestination.findFirst({
      where: { id: body.walletDestinationId, merchantId: merchant.merchantId },
    });
    if (!wallet) {
      reply.code(400).send({ error: 'invalid_wallet' });
      return;
    }
    if (wallet.status !== 'VERIFIED' || !wallet.isVerified) {
      reply.code(409).send({ error: 'wallet_not_verified' });
      return;
    }

    const normalized = {
      merchantId: merchant.merchantId,
      externalId: body.externalId,
      amountBrlCents: body.amountBrlCents,
      walletDestinationId: body.walletDestinationId,
      payerName: typeof body.payerName === 'string' ? body.payerName : undefined,
      payerTaxId: typeof body.payerTaxId === 'string' ? body.payerTaxId : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
    };

    const existing = await db.payment.findUnique({ where: { externalId: normalized.externalId } });
    if (existing && existing.merchantId !== merchant.merchantId) {
      reply.code(409).send({ error: 'external_id_conflict' });
      return;
    }

    if (existing) {
      let priorTaxId: string | undefined;
      try {
        priorTaxId = existing.payerTaxIdEncrypted ? decryptPii(existing.payerTaxIdEncrypted) : undefined;
      } catch {
        reply.code(409).send({ error: 'external_id_requires_reconciliation' });
        return;
      }
      const sameRequest = existing.amountBrlCents === BigInt(normalized.amountBrlCents)
        && existing.walletDestinationId === normalized.walletDestinationId
        && (existing.payerName?.trim() ?? null) === (normalized.payerName?.trim() ?? null)
        && priorTaxId?.trim() === normalized.payerTaxId?.trim()
        && (existing.description?.trim() ?? null) === (normalized.description?.trim() ?? null);
      if (!sameRequest) {
        reply.code(409).send({ error: 'external_id_reused_with_different_request' });
        return;
      }
    }

    const reservation = await reserveMerchantPaymentIdempotency(db, normalized, piiEncryptionKeyHex);
    if (reservation.kind === 'conflict') {
      reply.code(409).send({ error: 'external_id_reused_with_different_request' });
      return;
    }
    if (reservation.kind === 'in_progress' && !existing) {
      reply.header('Retry-After', '1');
      reply.code(409).send({ error: 'payment_creation_in_progress' });
      return;
    }
    if (reservation.kind === 'replayed') {
      if (!existing) {
        reply.code(409).send({ error: 'payment_record_missing_requires_reconciliation' });
        return;
      }
      reply.header('Idempotency-Replayed', 'true');
      reply.code(200).send(reservation.response);
      return;
    }

    if (existing) {
      // Recover the narrow crash window where the Payment row committed but
      // the HTTP response had not yet been stored by the onSend hook.
      const response = {
        paymentId: existing.id,
        externalId: existing.externalId,
        amountBrlCents: existing.amountBrlCents.toString(),
        usdtAmount: null,
        merchantNetUsdt: null,
        commissionUsdt: null,
        status: existing.status,
        pixQrCodeBase64: existing.pixQrCodeBase64,
        pixCopyPaste: existing.pixCopyPaste,
        expiresAt: existing.expiresAt?.toISOString() ?? null,
        providerOrderId: existing.providerOrderId,
        mode: 'mock',
        warning: 'Cobrança criada em modo de demonstração. Não aceite nem envie este código PIX como pagamento real.',
      };
      const completed = await db.$transaction(tx => completeMerchantPaymentIdempotency(
        tx,
        normalized.externalId,
        reservation.requestHash,
        response as Prisma.InputJsonObject,
      ));

      let responseToSend: Prisma.JsonObject | Prisma.InputJsonObject = response;
      if (!completed) {
        // Another request may have completed the same recovery concurrently.
        // Prefer its durable response instead of failing the losing request.
        const latest = await db.idempotencyRecord.findUnique({
          where: {
            scope_key: {
              scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
              key: normalized.externalId,
            },
          },
        });
        if (latest?.requestHash === reservation.requestHash && isJsonObject(latest.responseJson)) {
          responseToSend = latest.responseJson;
        } else {
          reply.header('Retry-After', '1');
          reply.code(409).send({ error: 'payment_creation_in_progress' });
          return;
        }
      }

      reply.header('Idempotency-Replayed', 'true');
      reply.code(200).send(responseToSend);
      return;
    }

    if (reservation.kind === 'reserved') {
      authenticated.merchantPaymentReservation = {
        externalId: normalized.externalId,
        requestHash: reservation.requestHash,
      };
    }
  };

  const onSend = async (
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown,
  ): Promise<unknown> => {
    const reservation = (request as MerchantAuthRequest).merchantPaymentReservation;
    if (!reservation || reply.statusCode !== 201 || (typeof payload !== 'string' && !Buffer.isBuffer(payload))) return payload;

    try {
      const response = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : payload) as Prisma.InputJsonObject;
      await db.$transaction(tx => completeMerchantPaymentIdempotency(
        tx,
        reservation.externalId,
        reservation.requestHash,
        response,
      ));
    } catch (error) {
      request.log.error(
        { err: error instanceof Error ? error.name : 'unknown' },
        'Merchant payment response could not be stored; reservation remains fail-closed',
      );
    }
    return payload;
  };

  return { preHandler, onSend };
}
