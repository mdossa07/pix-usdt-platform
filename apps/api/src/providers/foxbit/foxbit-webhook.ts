import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Foxbit Fiat Gateway V2 webhook envelope.
 * Gateway events use event_id/webhook_type and data.purchase_id/from_state/to_state.
 * Verify the raw request bytes before parsing; delivery retries keep the same event_id.
 */
export interface FoxbitWebhookEvent {
  event_id: string;
  webhook_type: string;
  timestamp: number;
  data: {
    purchase_id: string;
    from_state?: string;
    to_state?: string;
    [key: string]: unknown;
  };
}

export function verifyFoxbitWebhook(rawBody: Buffer, receivedSignature: string | undefined, secret: string): boolean {
  if (!receivedSignature || !secret || !/^[a-f0-9]{64}$/i.test(receivedSignature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(receivedSignature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseFoxbitWebhook(body: unknown): FoxbitWebhookEvent | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const envelope = body as Record<string, unknown>;
  if (typeof envelope.event_id !== 'string' || !envelope.event_id
    || typeof envelope.webhook_type !== 'string' || !envelope.webhook_type
    || typeof envelope.timestamp !== 'number' || !Number.isFinite(envelope.timestamp)
    || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) return null;
  const data = envelope.data as Record<string, unknown>;
  const purchaseId = typeof data.purchase_id === 'string' ? data.purchase_id
    : typeof data.purchase_id === 'number' ? String(data.purchase_id) : null;
  if (!purchaseId) return null;
  return {
    event_id: envelope.event_id,
    webhook_type: envelope.webhook_type,
    timestamp: envelope.timestamp,
    data: { ...data, purchase_id: purchaseId,
      from_state: typeof data.from_state === 'string' ? data.from_state : undefined,
      to_state: typeof data.to_state === 'string' ? data.to_state : undefined },
  };
}

/** PAID confirms PIX. FINISHED only describes Foxbit's own single-beneficiary delivery. */
export function mapWebhookStatusToPaymentState(webhookType: string, toState: string | undefined): 'PIX_CONFIRMED' | 'SETTLED' | 'FAILED' | 'UNKNOWN' {
  if (webhookType !== 'status_change' || !toState) return 'UNKNOWN';
  switch (toState.toUpperCase()) {
    case 'PAID': return 'PIX_CONFIRMED';
    case 'FINISHED': return 'SETTLED';
    case 'EXPIRED':
    case 'CANCELED': return 'FAILED';
    default: return 'UNKNOWN';
  }
}