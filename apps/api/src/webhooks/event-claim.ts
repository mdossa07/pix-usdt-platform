import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { decryptPii } from '../security/crypto.js';

const LEASE_MS = 60_000;

export type WebhookClaimResult =
  | { status: 'claimed'; eventId: string; token: string; duplicate: boolean }
  | { status: 'processed'; eventId: string }
  | { status: 'busy'; eventId: string };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Persist authenticated webhook payloads before applying financial side effects.
 * A short lease serializes concurrent deliveries across API instances. Expired
 * leases are recoverable after a process crash; completed events stay immutable.
 */
export async function claimWebhookEvent(
  db: PrismaClient,
  input: { provider: string; providerEventId: string; eventType: string; rawPayload: string; payloadEncrypted: string },
  now = new Date(),
): Promise<WebhookClaimResult> {
  const payloadHash = createHash('sha256').update(input.rawPayload).digest('hex');
  let duplicate = false;
  let event = await db.webhookEvent.findUnique({
    where: { provider_providerEventId: { provider: input.provider, providerEventId: input.providerEventId } },
  });

  if (!event) {
    try {
      event = await db.webhookEvent.create({
        data: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          payloadEncrypted: input.payloadEncrypted,
          payloadHash,
          signatureValid: true,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      duplicate = true;
      event = await db.webhookEvent.findUniqueOrThrow({
        where: { provider_providerEventId: { provider: input.provider, providerEventId: input.providerEventId } },
      });
    }
  } else {
    duplicate = true;
  }

  // Rows created before payload fingerprints were introduced must be verified
  // against their encrypted original body before they can be claimed or acked.
  // If decryption fails, fail closed: never trust an unverifiable legacy event.
  if (!event.payloadHash) {
    let originalPayload: string;
    try {
      originalPayload = decryptPii(event.payloadEncrypted);
    } catch {
      throw new Error('webhook_event_payload_conflict');
    }

    const originalHash = createHash('sha256').update(originalPayload).digest('hex');
    if (originalHash !== payloadHash) {
      throw new Error('webhook_event_payload_conflict');
    }

    // Multiple retries may race to backfill the same legacy row. The guarded
    // update preserves whichever matching hash was first written.
    await db.webhookEvent.updateMany({
      where: { id: event.id, payloadHash: null },
      data: { payloadHash: originalHash },
    });
    event = await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
  }

  // A provider event ID must identify one immutable payload. Never process a
  // second body under the same ID, even if its signature is independently valid.
  if (event.payloadHash !== payloadHash) {
    throw new Error('webhook_event_payload_conflict');
  }

  if (event.processedAt) return { status: 'processed', eventId: event.id };

  const token = randomUUID();
  const leaseExpiredBefore = new Date(now.getTime() - LEASE_MS);
  const claimed = await db.webhookEvent.updateMany({
    where: {
      id: event.id,
      processedAt: null,
      OR: [
        { processingAt: null },
        { processingAt: { lt: leaseExpiredBefore } },
      ],
    },
    data: { processingAt: now, processingToken: token },
  });

  if (claimed.count !== 1) return { status: 'busy', eventId: event.id };
  return { status: 'claimed', eventId: event.id, token, duplicate };
}

export async function completeWebhookEvent(db: PrismaClient, eventId: string, token: string): Promise<void> {
  const result = await db.webhookEvent.updateMany({
    where: { id: eventId, processingToken: token, processedAt: null },
    data: { processedAt: new Date(), processingAt: null, processingToken: null },
  });
  if (result.count !== 1) throw new Error('webhook_processing_lease_lost');
}

export async function releaseWebhookEvent(db: PrismaClient, eventId: string, token: string): Promise<void> {
  await db.webhookEvent.updateMany({
    where: { id: eventId, processingToken: token, processedAt: null },
    data: { processingAt: null, processingToken: null },
  });
}
