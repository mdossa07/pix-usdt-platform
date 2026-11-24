import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
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
});
