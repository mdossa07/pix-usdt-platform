import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { encryptPii } from '../security/crypto.js';
import { claimWebhookEvent, completeWebhookEvent } from './event-claim.js';

const schema = new URL(process.env.DATABASE_URL!);
schema.searchParams.set('schema', 'webhook_test');
const db = new PrismaClient({ datasources: { db: { url: schema.toString() } } });
const provider = 'WEBHOOK_CLAIM_TEST';
const encrypted = 'test-encrypted-payload';

afterAll(async () => {
  await db.webhookEvent.deleteMany({ where: { provider } });
  await db.$disconnect();
});

describe('webhook event claims', () => {
  it('allows only one concurrent worker to claim the same event', async () => {
    const input = { provider, providerEventId: 'concurrent-1', eventType: 'payment.updated', rawPayload: '{"id":"concurrent-1"}', payloadEncrypted: encrypted };
    const results = await Promise.all([
      claimWebhookEvent(db, input),
      claimWebhookEvent(db, input),
    ]);
    expect(results.filter((r) => r.status === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'busy')).toHaveLength(1);
  });

  it('rejects a different payload under an existing provider event ID', async () => {
    const input = { provider, providerEventId: 'collision-1', eventType: 'payment.updated', rawPayload: '{"amount":10}', payloadEncrypted: encrypted };
    await claimWebhookEvent(db, input);
    await expect(claimWebhookEvent(db, { ...input, rawPayload: '{"amount":1000}' })).rejects.toThrow('webhook_event_payload_conflict');
  });

  it('returns completed events without granting a second claim', async () => {
    const input = { provider, providerEventId: 'completed-1', eventType: 'payment.updated', rawPayload: '{"id":"completed-1"}', payloadEncrypted: encrypted };
    const first = await claimWebhookEvent(db, input);
    if (first.status !== 'claimed') throw new Error('expected initial claim');
    await completeWebhookEvent(db, first.eventId, first.token);
    const second = await claimWebhookEvent(db, input);
    expect(second.status).toBe('processed');
  });

  it('recovers an abandoned claim after its lease expires', async () => {
    const input = { provider, providerEventId: 'expired-lease-1', eventType: 'payment.updated', rawPayload: '{"id":"expired-lease-1"}', payloadEncrypted: encrypted };
    const first = await claimWebhookEvent(db, input, new Date('2026-01-01T00:00:00Z'));
    if (first.status !== 'claimed') throw new Error('expected initial claim');
    const recovered = await claimWebhookEvent(db, input, new Date('2026-01-01T00:02:00Z'));
    expect(recovered.status).toBe('claimed');
    if (recovered.status === 'claimed') expect(recovered.token).not.toBe(first.token);
  });

  it('verifies and backfills legacy rows from their encrypted original payload', async () => {
    const rawPayload = '{"id":"legacy-1","status":"paid"}';
    await db.webhookEvent.create({
      data: {
        provider,
        providerEventId: 'legacy-1',
        eventType: 'payment.updated',
        payloadEncrypted: encryptPii(rawPayload),
        payloadHash: null,
        signatureValid: true,
      },
    });

    const result = await claimWebhookEvent(db, {
      provider,
      providerEventId: 'legacy-1',
      eventType: 'payment.updated',
      rawPayload,
      payloadEncrypted: encryptPii(rawPayload),
    });
    expect(result.status).toBe('claimed');

    const stored = await db.webhookEvent.findUnique({
      where: { provider_providerEventId: { provider, providerEventId: 'legacy-1' } },
    });
    expect(stored?.payloadHash).toBe(createHash('sha256').update(rawPayload).digest('hex'));
  });

  it('rejects a legacy row when its incoming payload differs from the encrypted original', async () => {
    const originalPayload = '{"id":"legacy-conflict-1","amount":10}';
    await db.webhookEvent.create({
      data: {
        provider,
        providerEventId: 'legacy-conflict-1',
        eventType: 'payment.updated',
        payloadEncrypted: encryptPii(originalPayload),
        payloadHash: null,
        signatureValid: true,
      },
    });

    await expect(claimWebhookEvent(db, {
      provider,
      providerEventId: 'legacy-conflict-1',
      eventType: 'payment.updated',
      rawPayload: '{"id":"legacy-conflict-1","amount":1000}',
      payloadEncrypted: encryptPii('{"id":"legacy-conflict-1","amount":1000}'),
    })).rejects.toThrow('webhook_event_payload_conflict');
  });

  it('prevents an expired worker from completing a lease reclaimed by another worker', async () => {
    const input = { provider, providerEventId: 'fenced-lease-1', eventType: 'payment.updated', rawPayload: '{"id":"fenced-lease-1"}', payloadEncrypted: encrypted };
    const firstNow = new Date('2026-01-01T00:00:00Z');
    const first = await claimWebhookEvent(db, input, firstNow);
    if (first.status !== 'claimed') throw new Error('expected initial claim');

    const second = await claimWebhookEvent(db, input, new Date(firstNow.getTime() + 120_000));
    if (second.status !== 'claimed') throw new Error('expected reclaimed lease');

    await expect(completeWebhookEvent(db, first.eventId, first.token)).rejects.toThrow('webhook_processing_lease_lost');
    await expect(completeWebhookEvent(db, second.eventId, second.token)).resolves.toBeUndefined();
  });
});
