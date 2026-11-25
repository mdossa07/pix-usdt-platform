import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  completeMerchantPaymentIdempotency,
  reserveMerchantPaymentIdempotency,
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
    && (body.payerName === undefined || (typeof body.payerName === 'string' && body.payerName.length <= 200))
    && (body.payerTaxId === undefined || (typeof body.payerTaxId === 'string' && body.payerTaxId.length <= 64))
    && (body.description === undefined || (typeof body.description === 'string' && body.description.length <= 500));
}

export function createMerchantPaymentIdempotencyHooks(
  db: PrismaClient,
  piiEncryptionKeyHex: string,
) {
  const preHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authenticated = request as MerchantAuthRequest;
    const merchant = authenticated.merchant;
    const body = request.body as MerchantPaymentBody | null;
    if (!merchant || !body || !validBodyForFingerprint(body)) return;

    const normalized = {
      merchantId: merchant.merchantId,
      externalId: body.externalId,
      amountBrlCents: body.amountBrlCents,
      walletDestinationId: body.walletDestinationId,
      payerName: typeof body.payerName === 'string' ? body.payerName.trim() || undefined : undefined,
      payerTaxId: typeof body.payerTaxId === 'string' ? body.payerTaxId.trim() || undefined : undefined,
      description: typeof body.description === 'string' ? body.description.trim() || undefined : undefined,
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
        && existing.payerName === (normalized.payerName ?? null)
        && priorTaxId === normalized.payerTaxId
        && existing.description === (normalized.description ?? null);
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
        status: existing.status,
        pixQrCodeBase64: existing.pixQrCodeBase64,
        pixCopyPaste: existing.pixCopyPaste,
      };
      if (reservation.kind === 'reserved' || reservation.kind === 'in_progress') {
        await db.$transaction(tx => completeMerchantPaymentIdempotency(
          tx,
          normalized.externalId,
          reservation.kind === 'reserved' ? reservation.requestHash : (
            // The same request hash is recomputed by the reservation helper.
            reserveHashForExisting
          ),
          response as Prisma.InputJsonObject,
        ));
      }
      reply.code(200).send(response);
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
    payload: string | Buffer,
  ): Promise<string | Buffer> => {
    const reservation = (request as MerchantAuthRequest).merchantPaymentReservation;
    if (!reservation || reply.statusCode !== 201) return payload;

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
