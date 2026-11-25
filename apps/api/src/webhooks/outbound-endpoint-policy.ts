import type { Prisma } from '@prisma/client';

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
