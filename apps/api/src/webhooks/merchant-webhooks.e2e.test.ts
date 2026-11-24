import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMerchantWebhookDeliveries } from './outbound-outbox.js';

const databaseUrl = new URL(process.env.DATABASE_URL!);
databaseUrl.searchParams.set('schema', 'merchant_webhooks_test');
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
const suffix = randomUUID().replace(/-/g, '');
let userId = '';
let merchantId = '';
let walletId = '';
let createdEndpointId = '';
let completedEndpointId = '';
let disabledEndpointId = '';
let paymentId = '';

describe('transactional merchant webhook outbox', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `merchant-webhook-${suffix}@example.invalid`,
        passwordHash: 'test-only-not-a-real-password-hash',
        fullName: 'Merchant Webhook Test',
        role: 'MERCHANT',
      },
    });
    userId = user.id;

    const merchant = await prisma.merchant.create({
      data: {
        userId,
        merchantType: 'COMPANY',
        legalName: 'Merchant Webhook Test Ltda',
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
        label: 'Webhook test wallet',
        exchangeName: 'Mock Exchange',
        networkCode: 'polygon',
        addressEncrypted: 'test-encrypted-wallet',
        addressLast8: '12345678',
        holderName: 'Merchant Webhook Test Ltda',
        status: 'VERIFIED',
        isVerified: true,
        isDefault: true,
      },
    });
    walletId = wallet.id;

    const endpoints = await Promise.all([
      prisma.merchantWebhookEndpoint.create({
        data: {
          merchantId,
          url: 'https://hooks.example.com/created',
          events: ['payment.created', 'payment.status_changed'],
          signingSecretEncrypted: 'test-encrypted-secret-a',
        },
      }),
      prisma.merchantWebhookEndpoint.create({
        data: {
          merchantId,
          url: 'https://hooks.example.com/completed',
          events: ['payment.completed'],
          signingSecretEncrypted: 'test-encrypted-secret-b',
        },
      }),
      prisma.merchantWebhookEndpoint.create({
        data: {
          merchantId,
          url: 'https://hooks.example.com/disabled',
          events: ['payment.created'],
          signingSecretEncrypted: 'test-encrypted-secret-c',
          isEnabled: false,
        },
      }),
    ]);
    [createdEndpointId, completedEndpointId, disabledEndpointId] = endpoints.map(endpoint => endpoint.id);

    const payment = await prisma.payment.create({
      data: {
        merchantId,
        walletDestinationId: walletId,
        externalId: `webhook-${suffix}`,
        amountBrlCents: 12_345n,
        commissionBps: 200,
        status: 'PIX_PENDING',
      },
    });
    paymentId = payment.id;
  }, 20_000);

  afterAll(async () => {
    if (merchantId) {
      await prisma.merchantWebhookEndpoint.deleteMany({ where: { merchantId } });
      await prisma.payment.deleteMany({ where: { merchantId } });
      await prisma.walletDestination.deleteMany({ where: { merchantId } });
    }
    if (userId) {
      await prisma.merchant.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  }, 20_000);

  it('creates only subscribed, enabled deliveries with a non-PII payload', async () => {
    const count = await prisma.$transaction(tx =>
      createMerchantWebhookDeliveries(tx, paymentId, 'payment.created'),
    );
    expect(count).toBe(1);

    const deliveries = await prisma.merchantWebhookDelivery.findMany({
      where: { endpointId: { in: [createdEndpointId, completedEndpointId, disabledEndpointId] } },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].endpointId).toBe(createdEndpointId);
    expect(deliveries[0].eventName).toBe('payment.created');
    expect(deliveries[0].status).toBe('PENDING');
    expect(deliveries[0].attempts).toBe(0);

    const payload = deliveries[0].payload as {
      id?: string;
      type?: string;
      data?: Record<string, unknown>;
    };
    expect(payload.id).toBe(deliveries[0].eventId);
    expect(payload.type).toBe('payment.created');
    expect(payload.data?.paymentId).toBe(paymentId);
    expect(payload.data?.amountBrlCents).toBe('12345');
    expect(payload.data?.currency).toBe('BRL');
    expect(payload.data).not.toHaveProperty('payerTaxId');
    expect(payload.data).not.toHaveProperty('payerEmail');
    expect(payload.data).not.toHaveProperty('walletAddress');
  }, 20_000);

  it('writes status and completion events to each matching subscription', async () => {
    const changedCount = await prisma.$transaction(async tx => {
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'CONVERSION_PENDING' } });
      return createMerchantWebhookDeliveries(tx, paymentId, 'payment.status_changed');
    });
    expect(changedCount).toBe(1);

    const completedCount = await prisma.$transaction(async tx => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const genericCount = await createMerchantWebhookDeliveries(tx, paymentId, 'payment.status_changed');
      const completedCount = await createMerchantWebhookDeliveries(tx, paymentId, 'payment.completed');
      return genericCount + completedCount;
    });
    expect(completedCount).toBe(2);

    const rows = await prisma.merchantWebhookDelivery.findMany({
      where: { endpointId: { in: [createdEndpointId, completedEndpointId] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.filter(row => row.eventName === 'payment.status_changed')).toHaveLength(2);
    expect(rows.filter(row => row.eventName === 'payment.completed')).toHaveLength(1);
    expect(rows.find(row => row.eventName === 'payment.completed')?.endpointId).toBe(completedEndpointId);
  }, 20_000);

  it('rolls outbox rows back when the payment transaction is rolled back', async () => {
    const another = await prisma.payment.create({
      data: {
        merchantId,
        walletDestinationId: walletId,
        externalId: `webhook-rollback-${suffix}`,
        amountBrlCents: 5000n,
        commissionBps: 200,
        status: 'PIX_PENDING',
      },
    });

    await expect(prisma.$transaction(async tx => {
      await tx.payment.update({ where: { id: another.id }, data: { status: 'PIX_CONFIRMED' } });
      await createMerchantWebhookDeliveries(tx, another.id, 'payment.status_changed');
      throw new Error('force_transaction_rollback');
    })).rejects.toThrow('force_transaction_rollback');

    const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: another.id } });
    expect(storedPayment.status).toBe('PIX_PENDING');
    const rolledBack = await prisma.merchantWebhookDelivery.findMany({
      where: { endpointId: createdEndpointId, eventName: 'payment.status_changed' },
    });
    expect(rolledBack).toHaveLength(2);
  }, 20_000);
});
