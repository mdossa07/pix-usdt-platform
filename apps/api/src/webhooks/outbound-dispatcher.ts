import type { PrismaClient } from '@prisma/client';
import { decryptPii } from '../security/crypto.js';
import { sendSignedWebhook } from './outbound-security.js';

const MAX_ATTEMPTS = 8;
const LOCK_TTL_MS = 30_000;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000, 86_400_000];

export function merchantWebhookRetryDelay(attempt: number): number {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, attempt - 1));
  return RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS.at(-1) ?? 0;
}

export function startMerchantWebhookDispatcher(
  prisma: PrismaClient,
  onError: (error: unknown) => void = () => undefined,
) {
  let running: Promise<void> | null = null;

  const processDelivery = async (id: string): Promise<void> => {
    const now = new Date();
    const claimed = await prisma.merchantWebhookDelivery.updateMany({
      where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        lockedAt: now,
        lastAttemptAt: now,
      },
    });
    if (claimed.count !== 1) return;

    const delivery = await prisma.merchantWebhookDelivery.findUnique({
      where: { id },
      include: { endpoint: true },
    });
    if (!delivery) return;

    if (!delivery.endpoint.isEnabled) {
      await prisma.merchantWebhookDelivery.update({
        where: { id },
        data: {
          status: 'FAILED',
          lockedAt: null,
          lastErrorCode: 'webhook_endpoint_disabled',
        },
      });
      return;
    }

    try {
      const result = await sendSignedWebhook({
        endpointUrl: delivery.endpoint.url,
        secret: decryptPii(delivery.endpoint.signingSecretEncrypted),
        eventId: delivery.eventId,
        eventName: delivery.eventName,
        payload: delivery.payload,
      });
      await prisma.merchantWebhookDelivery.update({
        where: { id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          lockedAt: null,
          responseStatus: result.statusCode,
          lastErrorCode: null,
        },
      });
    } catch (error) {
      const attempts = delivery.attempts;
      const failedPermanently = attempts >= MAX_ATTEMPTS;
      await prisma.merchantWebhookDelivery.update({
        where: { id },
        data: {
          status: failedPermanently ? 'FAILED' : 'PENDING',
          nextAttemptAt: failedPermanently
            ? delivery.nextAttemptAt
            : new Date(Date.now() + merchantWebhookRetryDelay(attempts)),
          lockedAt: null,
          lastErrorCode: error instanceof Error
            ? error.message.replace(/[^A-Za-z0-9_:-]/g, '_').slice(0, 120)
            : 'webhook_delivery_failed',
        },
      });
    }
  };

  const poll = async (): Promise<void> => {
    // Recover work abandoned by a process that crashed after claiming a row.
    const now = new Date();
    await prisma.merchantWebhookDelivery.updateMany({
      where: {
        status: 'PROCESSING',
        lockedAt: { lt: new Date(now.getTime() - LOCK_TTL_MS) },
      },
      data: {
        status: 'PENDING',
        lockedAt: null,
        nextAttemptAt: now,
        lastErrorCode: 'webhook_delivery_lock_expired',
      },
    });

    const due = await prisma.merchantWebhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
      take: 20,
    });
    await Promise.all(due.map(item => processDelivery(item.id)));
  };

  const tick = (): void => {
    if (running) return;
    running = poll().catch(onError).finally(() => {
      running = null;
    });
  };

  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();

  return {
    async close(): Promise<void> {
      clearInterval(timer);
      if (running) await running;
    },
  };
}
