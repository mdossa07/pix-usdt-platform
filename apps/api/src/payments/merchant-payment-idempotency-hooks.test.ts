import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createMerchantPaymentIdempotencyHooks } from './merchant-payment-idempotency-hooks.js';
import { hashMerchantPaymentRequest, MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE } from './merchant-payment-idempotency.js';

const piiKey = 'a'.repeat(64);
const baseBody = {
  amountBrlCents: 5000,
  walletDestinationId: 'wallet-1',
  externalId: 'merchant-external-1',
  payerName: 'Payer',
  payerTaxId: '12345678909',
  description: 'Checkout',
};

function makeReply() {
  const state: {
    statusCode: number;
    headers: Record<string, string>;
    sent: unknown;
  } = { statusCode: 200, headers: {}, sent: undefined };

  const reply = {
    get statusCode() { return state.statusCode; },
    set statusCode(value: number) { state.statusCode = value; },
    code(value: number) { state.statusCode = value; return this; },
    header(name: string, value: string) { state.headers[name] = value; return this; },
    send(value: unknown) { state.sent = value; return this; },
  } as unknown as FastifyReply;

  return { reply, state };
}

function makeRequest(body: Record<string, unknown>): FastifyRequest {
  return {
    body,
    merchant: { merchantId: 'merchant-1', keyId: 'key-1' },
    log: { error() {} },
  } as unknown as FastifyRequest;
}

function makeDb(options: {
  existingPayment?: Record<string, unknown> | null;
  idempotencyRecord?: Record<string, unknown> | null;
}) {
  let record = options.idempotencyRecord ?? null;
  const responseWrites: unknown[] = [];
  const tx = {
    idempotencyRecord: {
      findUnique: async () => record,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        record = { ...data, responseJson: null };
        return record;
      },
      updateMany: async ({ data }: { data: { responseJson: unknown } }) => {
        if (!record) return { count: 0 };
        record = { ...record, responseJson: data.responseJson };
        responseWrites.push(data.responseJson);
        return { count: 1 };
      },
    },
  };

  const db = {
    merchant: {
      findUnique: async () => ({ isEnabled: true, kycStatus: 'APPROVED' }),
    },
    walletDestination: {
      findFirst: async () => ({
        id: 'wallet-1',
        merchantId: 'merchant-1',
        status: 'VERIFIED',
        isVerified: true,
      }),
    },
    payment: {
      findUnique: async () => options.existingPayment ?? null,
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaClient;

  return {
    db,
    get record() { return record; },
    responseWrites,
  };
}

test('disabled financial execution rejects before reading or reserving a merchant payment', async () => {
  const hooks = createMerchantPaymentIdempotencyHooks({} as PrismaClient, piiKey, false);
  const { reply, state } = makeReply();

  await hooks.preHandler(makeRequest(baseBody), reply);

  assert.equal(state.statusCode, 503);
  assert.deepEqual(state.sent, { error: 'financial_operations_disabled' });
});

test('extra fields ignored by the Zod route schema do not bypass the externalId reservation', async () => {
  const fake = makeDb({});
  const hooks = createMerchantPaymentIdempotencyHooks(fake.db, piiKey);
  const request = makeRequest({ ...baseBody, ignoredByRouteSchema: 'legacy-client-field' });
  const { reply, state } = makeReply();

  await hooks.preHandler(request, reply);

  assert.equal(state.statusCode, 200);
  assert.equal((request as unknown as { merchantPaymentReservation?: { externalId: string } }).merchantPaymentReservation?.externalId, baseBody.externalId);
  assert.equal(fake.record?.scope, MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE);
  assert.equal(fake.record?.key, baseBody.externalId);
});

test('recovery after payment persistence rebuilds the complete original response contract', async () => {
  const recoveryBody = {
    amountBrlCents: baseBody.amountBrlCents,
    walletDestinationId: baseBody.walletDestinationId,
    externalId: baseBody.externalId,
    payerName: baseBody.payerName,
    description: baseBody.description,
  };
  const input = {
    merchantId: 'merchant-1',
    ...recoveryBody,
  };
  const requestHash = hashMerchantPaymentRequest(input, piiKey);
  const expiresAt = new Date('2026-11-25T18:00:00.000Z');
  const existingPayment = {
    id: 'payment-1',
    externalId: baseBody.externalId,
    merchantId: 'merchant-1',
    amountBrlCents: 5000n,
    walletDestinationId: 'wallet-1',
    payerName: 'Payer',
    payerTaxIdEncrypted: null,
    description: 'Checkout',
    status: 'PIX_PENDING',
    pixQrCodeBase64: 'mock-qr',
    pixCopyPaste: 'MOCK-PIX-NOT-PAYABLE:sample',
    expiresAt,
    providerOrderId: 'provider-charge-1',
  };
  const fake = makeDb({
    existingPayment,
    idempotencyRecord: {
      scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
      key: baseBody.externalId,
      requestHash,
      responseJson: null,
    },
  });
  const hooks = createMerchantPaymentIdempotencyHooks(fake.db, piiKey);
  const { reply, state } = makeReply();

  await hooks.preHandler(makeRequest(recoveryBody), reply);

  assert.equal(state.statusCode, 200);
  assert.equal(state.headers['Idempotency-Replayed'], 'true');
  assert.equal(fake.responseWrites.length, 1);
  assert.deepEqual(fake.record?.responseJson, {
    paymentId: 'payment-1',
    externalId: baseBody.externalId,
    amountBrlCents: '5000',
    usdtAmount: null,
    merchantNetUsdt: null,
    commissionUsdt: null,
    status: 'PIX_PENDING',
    pixQrCodeBase64: 'mock-qr',
    pixCopyPaste: 'MOCK-PIX-NOT-PAYABLE:sample',
    expiresAt: expiresAt.toISOString(),
    providerOrderId: 'provider-charge-1',
    mode: 'mock',
    warning: 'Cobrança criada em modo de demonstração. Não aceite nem envie este código PIX como pagamento real.',
  });
});
