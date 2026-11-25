import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  completeMerchantPaymentIdempotency,
  MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
  reserveMerchantPaymentIdempotency,
} from './merchant-payment-idempotency.js';

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, '');
const piiKey = 'a'.repeat(64);

afterAll(async () => {
  await prisma.idempotencyRecord.deleteMany({
    where: {
      scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE,
      key: { startsWith: `merchant-payment-${suffix}` },
    },
  });
  await prisma.$disconnect();
}, 20_000);

describe('HMAC merchant payment idempotency', () => {
  it('serializes concurrent externalIds, rejects changed requests, and replays the completed response', async () => {
    const externalId = `merchant-payment-${suffix}-concurrent`;
    const input = {
      merchantId: 'test-merchant',
      externalId,
      amountBrlCents: 5000,
      walletDestinationId: 'test-wallet',
      payerName: '  Test Payer  ',
      payerTaxId: '12345678909',
      description: '  Merchant checkout  ',
    };

    const results = await Promise.all([
      reserveMerchantPaymentIdempotency(prisma, input, piiKey),
      reserveMerchantPaymentIdempotency(prisma, input, piiKey),
    ]);
    expect(results.map(result => result.kind).sort()).toEqual(['in_progress', 'reserved']);

    const reservation = results.find(result => result.kind === 'reserved');
    if (!reservation || reservation.kind !== 'reserved') {
      throw new Error('expected exactly one reservation owner');
    }

    const changedAmount = await reserveMerchantPaymentIdempotency(
      prisma,
      { ...input, amountBrlCents: 6000 },
      piiKey,
    );
    expect(changedAmount.kind).toBe('conflict');

    const otherMerchant = await reserveMerchantPaymentIdempotency(
      prisma,
      { ...input, merchantId: 'different-merchant' },
      piiKey,
    );
    expect(otherMerchant.kind).toBe('conflict');

    const response = {
      paymentId: `mock-payment-${suffix}`,
      externalId,
      status: 'PIX_PENDING',
      pixCopyPaste: 'MOCK-PIX-NOT-PAYABLE:test',
    };
    await prisma.$transaction(tx => completeMerchantPaymentIdempotency(
      tx,
      externalId,
      reservation.requestHash,
      response,
    ));

    const replay = await reserveMerchantPaymentIdempotency(prisma, input, piiKey);
    expect(replay.kind).toBe('replayed');
    if (replay.kind !== 'replayed') throw new Error('expected a completed response replay');
    expect(replay.response).toEqual(response);

    expect(await prisma.idempotencyRecord.count({
      where: { scope: MERCHANT_PAYMENT_IDEMPOTENCY_SCOPE, key: externalId },
    })).toBe(1);
  }, 20_000);
});
