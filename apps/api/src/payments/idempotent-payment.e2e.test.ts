import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPaymentIdempotently } from './idempotent-payment.js';

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, '');
let userId = '';
let merchantId = '';
let walletId = '';

async function createInput(idempotencyKey: string, amountBrlCents = 5_000, commissionBps = 200) {
  return {
    merchantId,
    actorUserId: userId,
    walletDestinationId: walletId,
    amountBrlCents,
    commissionBps,
    description: 'Integration test payment',
    idempotencyKey,
    ipAddress: '127.0.0.1',
  };
}

describe('idempotent payment creation', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `payment-idempotency-${suffix}@example.invalid`,
        passwordHash: 'test-only-not-a-real-password-hash',
        fullName: 'Payment Idempotency Test',
        role: 'MERCHANT',
        isActive: true,
      },
    });
    userId = user.id;

    const merchant = await prisma.merchant.create({
      data: {
        userId,
        merchantType: 'COMPANY',
        legalName: 'Payment Idempotency Test Ltda',
        taxIdEncrypted: 'test-encrypted-tax-id',
        taxIdLast4: '1234',
        kycStatus: 'APPROVED',
        isEnabled: true,
      },
    });
    merchantId = merchant.id;

    const wallet = await prisma.walletDestination.create({
      data: {
        merchantId,
        label: 'Integration test wallet',
        exchangeName: 'Mock Exchange',
        networkCode: 'TRC20',
        currencySymbol: 'usdt',
        addressEncrypted: 'test-encrypted-wallet-address',
        addressLast8: '12345678',
        walletType: 'HOSTED',
        walletOwner: 'SELF',
        status: 'VERIFIED',
        holderName: 'Payment Idempotency Test Ltda',
        isVerified: true,
        isDefault: true,
      },
    });
    walletId = wallet.id;
  }, 20_000);

  afterAll(async () => {
    if (merchantId) {
      await prisma.payment.deleteMany({ where: { merchantId } });
      await prisma.walletDestination.deleteMany({ where: { merchantId } });
    }
    if (userId) {
      await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
      await prisma.merchant.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: { startsWith: `merchant:POST:/v1/payments:${merchantId}` } },
    });
    await prisma.$disconnect();
  }, 20_000);

  it('serializes concurrent same-key requests and creates exactly one payment', async () => {
    const key = `payment-${suffix}-concurrent`;
    const input = await createInput(key, 5_000, 225);
    const results = await Promise.all([
      createPaymentIdempotently(prisma, input),
      createPaymentIdempotently(prisma, input),
    ]);

    expect(results.map(result => result.kind).sort()).toEqual(['created', 'replayed']);
    const responses = results.map(result => {
      if (result.kind !== 'created' && result.kind !== 'replayed') throw new Error(result.kind);
      return result.response;
    });
    expect(new Set(responses.map(response => response.id)).size).toBe(1);
    const firstResponse = responses.at(0);
    if (!firstResponse) throw new Error('expected a stored payment response');
    expect(firstResponse.status).toBe('PIX_PENDING');
    const savedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: firstResponse.id } });
    expect(savedPayment.status).toBe('PIX_PENDING');
    expect(savedPayment.commissionBps).toBe(225);
    expect(await prisma.payment.count({ where: { merchantId } })).toBe(1);
    expect(await prisma.idempotencyRecord.count({
      where: { scope: `merchant:POST:/v1/payments:${merchantId}`, key },
    })).toBe(1);
  }, 20_000);

  it('rejects reuse of the same key with a different request body', async () => {
    const key = `payment-${suffix}-changed-body`;
    const first = await createPaymentIdempotently(prisma, await createInput(key, 5_000));
    const second = await createPaymentIdempotently(prisma, await createInput(key, 6_000));

    expect(first.kind).toBe('created');
    expect(second.kind).toBe('idempotency_conflict');
    expect(await prisma.payment.count({ where: { merchantId } })).toBe(2);
  }, 20_000);

  it('does not create a payment when the selected wallet is unverified', async () => {
    const unverified = await prisma.walletDestination.create({
      data: {
        merchantId,
        label: 'Unverified test wallet',
        exchangeName: 'Mock Exchange',
        networkCode: 'TRC20',
        addressEncrypted: 'test-encrypted-unverified-wallet',
        addressLast8: '87654321',
        holderName: 'Payment Idempotency Test Ltda',
        status: 'PENDING_VERIFICATION',
        isVerified: false,
      },
    });
    const result = await createPaymentIdempotently(prisma, {
      ...(await createInput(`payment-${suffix}-unverified-wallet`)),
      walletDestinationId: unverified.id,
    });

    expect(result.kind).toBe('wallet_not_verified');
    expect(await prisma.payment.count({ where: { merchantId } })).toBe(2);
  }, 20_000);
});
