import type { Prisma } from '@prisma/client';

export type MerchantWebhookRetryResult =
  | { kind: 'not_found' }
  | { kind: 'endpoint_disabled' }
  | { kind: 'not_failed'; currentStatus: string }
  | { kind: 'conflict' }
  | { kind: 'requeued'; eventId: string; nextAttemptAt: Date };

/**
 * Reopens the existing failed outbox row. The event ID and original JSON
 * payload are preserved so consumers can deduplicate the at-least-once retry.
 */
export async function requeueFailedMerchantWebhookDelivery(
  tx: Prisma.TransactionClient,
  input: {
    merchantId: string;
    endpointId: string;
    deliveryId: string;
  },
): Promise<MerchantWebhookRetryResult> {
  const endpoint = await tx.merchantWebhookEndpoint.findFirst({
    where: { id: input.endpointId, merchantId: input.merchantId },
    select: { id: true, isEnabled: true },
  });
  if (!endpoint) return { kind: 'not_found' };
  if (!endpoint.isEnabled) return { kind: 'endpoint_disabled' };

  const delivery = await tx.merchantWebhookDelivery.findFirst({
    where: { id: input.deliveryId, endpointId: endpoint.id },
    select: { id: true, eventId: true, status: true },
  });
  if (!delivery) return { kind: 'not_found' };
  if (delivery.status !== 'FAILED') {
    return { kind: 'not_failed', currentStatus: delivery.status };
  }

  const nextAttemptAt = new Date();
  const updated = await tx.merchantWebhookDelivery.updateMany({
    where: {
      id: delivery.id,
      endpointId: endpoint.id,
      status: 'FAILED',
    },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt,
      lockedAt: null,
      lastAttemptAt: null,
      deliveredAt: null,
      responseStatus: null,
      lastErrorCode: null,
    },
  });
  if (updated.count !== 1) return { kind: 'conflict' };

  return {
    kind: 'requeued',
    eventId: delivery.eventId,
    nextAttemptAt,
  };
}
