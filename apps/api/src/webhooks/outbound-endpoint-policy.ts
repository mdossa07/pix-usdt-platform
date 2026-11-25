import { Prisma, PrismaClient } from '@prisma/client';

export const MAX_ACTIVE_MERCHANT_WEBHOOK_ENDPOINTS = 10;

export async function hasMerchantWebhookEndpointCapacity(
  tx: Prisma.TransactionClient,
  merchantId: string,
): Promise<boolean> {
  const activeCount = await tx.merchantWebhookEndpoint.count({
    where: { merchantId, isEnabled: true },
  });
  return activeCount < MAX_ACTIVE_MERCHANT_WEBHOOK_ENDPOINTS;
}

function isSerializationConflict(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2034';
}

export type CreateMerchantWebhookEndpointResult =
  | { kind: 'created'; endpoint: { id: string; url: string; events: string[]; isEnabled: boolean; createdAt: Date } }
  | { kind: 'limit_reached' }
  | { kind: 'conflict' };

export async function createMerchantWebhookEndpointWithCapacity(
  prisma: PrismaClient,
  input: {
    merchantId: string;
    url: string;
    events: string[];
    signingSecretEncrypted: string;
    actorUserId: string;
    ipAddress: string;
    host: string;
  },
): Promise<CreateMerchantWebhookEndpointResult> {
  try {
    return await prisma.$transaction(async tx => {
      const hasCapacity = await hasMerchantWebhookEndpointCapacity(tx, input.merchantId);
      if (!hasCapacity) return { kind: 'limit_reached' as const };

      const endpoint = await tx.merchantWebhookEndpoint.create({
        data: {
          merchantId: input.merchantId,
          url: input.url,
          events: input.events,
          signingSecretEncrypted: input.signingSecretEncrypted,
        },
        select: { id: true, url: true, events: true, isEnabled: true, createdAt: true },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: input.actorUserId,
          action: 'MERCHANT_WEBHOOK_CREATED',
          entityType: 'MERCHANT_WEBHOOK_ENDPOINT',
          entityId: endpoint.id,
          ipAddress: input.ipAddress,
          metadata: {
            host: input.host,
            events: input.events,
          } as Prisma.InputJsonObject,
        },
      });

      return { kind: 'created' as const, endpoint };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializationConflict(error)) return { kind: 'conflict' };
    throw error;
  }
}

export type EnableMerchantWebhookEndpointResult =
  | { kind: 'not_found' }
  | { kind: 'limit_reached' }
  | { kind: 'conflict' }
  | { kind: 'enabled'; endpoint: { id: string; isEnabled: true } };

export async function enableMerchantWebhookEndpointWithCapacity(
  prisma: PrismaClient,
  input: {
    merchantId: string;
    endpointId: string;
    actorUserId: string;
    ipAddress: string;
  },
): Promise<EnableMerchantWebhookEndpointResult> {
  try {
    return await prisma.$transaction(async tx => {
      const endpoint = await tx.merchantWebhookEndpoint.findFirst({
        where: { id: input.endpointId, merchantId: input.merchantId },
        select: { id: true, isEnabled: true },
      });
      if (!endpoint) return { kind: 'not_found' as const };
      if (endpoint.isEnabled) {
        return { kind: 'enabled' as const, endpoint: { id: endpoint.id, isEnabled: true as const } };
      }

      const hasCapacity = await hasMerchantWebhookEndpointCapacity(tx, input.merchantId);
      if (!hasCapacity) return { kind: 'limit_reached' as const };

      const updated = await tx.merchantWebhookEndpoint.updateMany({
        where: { id: endpoint.id, merchantId: input.merchantId, isEnabled: false },
        data: { isEnabled: true },
      });
      if (updated.count !== 1) return { kind: 'conflict' as const };

      await tx.auditEvent.create({
        data: {
          actorUserId: input.actorUserId,
          action: 'MERCHANT_WEBHOOK_ENDPOINT_ENABLED',
          entityType: 'MERCHANT_WEBHOOK_ENDPOINT',
          entityId: endpoint.id,
          ipAddress: input.ipAddress,
        },
      });

      return { kind: 'enabled' as const, endpoint: { id: endpoint.id, isEnabled: true as const } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializationConflict(error)) return { kind: 'conflict' };
    throw error;
  }
}
