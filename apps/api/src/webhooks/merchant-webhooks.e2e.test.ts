import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMerchantWebhookDeliveries } from './outbound-outbox.js';
import { requeueFailedMerchantWebhookDelivery } from './outbound-retry.js';

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
    const createdEndpoint = endpoints[0];
    const completedEndpoint = endpoints[1];
    const disabledEndpoint = endpoints[2];
    if (!createdEndpoint || !completedEndpoint || !disabledEndpoint) {
      throw new Error('webhook_test_endpoints_missing');
    }
    createdEndpointId = createdEndpoint.id;
    completedEndpointId = completedEndpoint.id;
    disabledEndpointId = disabledEndpoint.id;

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
    const delivery = deliveries[0];
    if (!delivery) throw new Error('expected_one_webhook_delivery');
    expect(delivery.endpointId).toBe(createdEndpointId);
    expect(delivery.eventName).toBe('payment.created');
    expect(delivery.status).toBe('PENDING');
    expect(delivery.attempts).toBe(0);

    const payload = delivery.payload as {
      id?: string;
      type?: string;
      data?: Record<string, unknown>;
    };
    expect(payload.id).toBe(delivery.eventId);
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
    const completedDelivery = rows.find(row => row.eventName === 'payment.completed');
    if (!completedDelivery) throw new Error('expected_payment_completed_delivery');
    expect(completedDelivery.endpointId).toBe(completedEndpointId);
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
  it('requeues only failed deliveries while preserving the event ID and payload', async () => {
    const eventId = randomUUID();
    const originalPayload = {
      id: eventId,
      type: 'payment.status_changed',
      data: { paymentId, status: 'UNDER_REVIEW', amountBrlCents: '12345' },
    };
    const failed = await prisma.merchantWebhookDelivery.create({
      data: {
        endpointId: createdEndpointId,
        eventName: 'payment.status_changed',
        eventId,
        payload: originalPayload,
        status: 'FAILED',
        attempts: 8,
        nextAttemptAt: new Date(Date.now() + 60_000),
        lastErrorCode: 'webhook_timeout',
        responseStatus: null,
      },
    });

    const outcome = await prisma.$transaction(tx =>
      requeueFailedMerchantWebhookDelivery(tx, {
        merchantId,
        endpointId: createdEndpointId,
        deliveryId: failed.id,
      }),
    );
    expect(outcome.kind).toBe('requeued');
    if (outcome.kind !== 'requeued') throw new Error('failed_delivery_was_not_requeued');
    expect(outcome.eventId).toBe(eventId);

    const stored = await prisma.merchantWebhookDelivery.findUniqueOrThrow({ where: { id: failed.id } });
    expect(stored.status).toBe('PENDING');
    expect(stored.attempts).toBe(0);
    expect(stored.eventId).toBe(eventId);
    expect(stored.payload).toEqual(originalPayload);
    expect(stored.lastErrorCode).toBeNull();
    expect(stored.responseStatus).toBeNull();
    expect(stored.lockedAt).toBeNull();
    expect(stored.deliveredAt).toBeNull();

    const pendingRetry = await prisma.$transaction(tx =>
      requeueFailedMerchantWebhookDelivery(tx, {
        merchantId,
        endpointId: createdEndpointId,
        deliveryId: failed.id,
      }),
    );
    expect(pendingRetry).toEqual({ kind: 'not_failed', currentStatus: 'PENDING' });
  }, 20_000);

  it('does not retry disabled endpoints or deliveries owned by another merchant', async () => {
    const disabledEventId = randomUUID();
    const disabledDelivery = await prisma.merchantWebhookDelivery.create({
      data: {
        endpointId: disabledEndpointId,
        eventName: 'payment.created',
        eventId: disabledEventId,
        payload: { id: disabledEventId, type: 'payment.created', data: { paymentId } },
        status: 'FAILED',
        attempts: 8,
        lastErrorCode: 'webhook_endpoint_disabled',
      },
    });
    const disabledOutcome = await prisma.$transaction(tx =>
      requeueFailedMerchantWebhookDelivery(tx, {
        merchantId,
        endpointId: disabledEndpointId,
        deliveryId: disabledDelivery.id,
      }),
    );
    expect(disabledOutcome).toEqual({ kind: 'endpoint_disabled' });

    const otherMerchantOutcome = await prisma.$transaction(tx =>
      requeueFailedMerchantWebhookDelivery(tx, {
        merchantId: 'merchant-not-owned',
        endpointId: createdEndpointId,
        deliveryId: disabledDelivery.id,
      }),
    );
    expect(otherMerchantOutcome).toEqual({ kind: 'not_found' });
  }, 20_000);

});
