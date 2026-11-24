import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export const MERCHANT_WEBHOOK_EVENTS = [
  'payment.created',
  'payment.status_changed',
  'payment.completed',
] as const;

export type MerchantWebhookEventName = typeof MERCHANT_WEBHOOK_EVENTS[number];

const allowedEvents = new Set<string>(MERCHANT_WEBHOOK_EVENTS);

export function isMerchantWebhookEventName(value: string): value is MerchantWebhookEventName {
  return allowedEvents.has(value);
}

/**
 * Writes merchant webhook deliveries in the same PostgreSQL transaction as the
 * payment change. Delivery is asynchronous; no HTTP request is made in a payment
 * transaction and the durable rows survive Redis/process outages.
 */
export async function createMerchantWebhookDeliveries(
  tx: Prisma.TransactionClient,
  paymentId: string,
  eventName: MerchantWebhookEventName,
): Promise<number> {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      merchantId: true,
      externalId: true,
      status: true,
      amountBrlCents: true,
      commissionBps: true,
      commissionUsdt: true,
      merchantNetUsdt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!payment) throw new Error('webhook_payment_not_found');

  const endpoints = await tx.merchantWebhookEndpoint.findMany({
    where: {
      merchantId: payment.merchantId,
      isEnabled: true,
      events: { has: eventName },
    },
    select: { id: true },
  });
  if (endpoints.length === 0) return 0;

  const eventId = randomUUID();
  const payload = {
    id: eventId,
    type: eventName,
    createdAt: new Date().toISOString(),
    data: {
      paymentId: payment.id,
      externalId: payment.externalId,
      status: payment.status,
      amountBrlCents: payment.amountBrlCents.toString(),
      currency: 'BRL',
      commissionBps: payment.commissionBps,
      commissionUsdt: payment.commissionUsdt?.toString() ?? null,
      merchantNetUsdt: payment.merchantNetUsdt?.toString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    },
  };

  const result = await tx.merchantWebhookDelivery.createMany({
    data: endpoints.map(endpoint => ({
      endpointId: endpoint.id,
      eventName,
      eventId,
      payload,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
