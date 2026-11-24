import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Foxbit Partner API v3 Webhook Handler
 *
 * Official docs: https://docs.foxbit.com.br/rest/v3/partners/#webhooks
 * - Signature header: X-FB-SIGNATURE (HMAC-SHA256 of raw body)
 * - Event types: status_change for Fiat Gateway orders and withdrawals
 * - Deduplication: use event_id to prevent reprocessing
 */

export interface FoxbitWebhookEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  data: {
    id: string; // order_id or withdrawal_id
    type: 'fiat_gateway_order' | 'withdrawal';
    status: string;
    [key: string]: unknown;
  };
}

/**
 * Verify Foxbit webhook signature using HMAC-SHA256.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyFoxbitWebhook(
  rawBody: Buffer,
  receivedSignature: string | undefined,
  secret: string,
): boolean {
  if (!receivedSignature || !secret) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = Buffer.from(receivedSignature.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  // Constant-time comparison prevents timing side-channel attacks
  return (
    received.length === expectedBuffer.length &&
    timingSafeEqual(received, expectedBuffer)
  );
}

/**
 * Parse and validate Foxbit webhook payload.
 * Returns null if payload is malformed or missing required fields.
 */
export function parseFoxbitWebhook(body: unknown): FoxbitWebhookEvent | null {
  if (!body || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;

  // Validate required fields per Partner API v3 spec
  if (typeof obj.event_id !== 'string' || !obj.event_id) return null;
  if (typeof obj.event_type !== 'string' || !obj.event_type) return null;
  if (typeof obj.timestamp !== 'string' || !obj.timestamp) return null;
  if (!obj.data || typeof obj.data !== 'object') return null;

  const data = obj.data as Record<string, unknown>;
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.status !== 'string' || !data.status) return null;

  return {
    event_id: obj.event_id,
    event_type: obj.event_type,
    timestamp: obj.timestamp,
    data: {
      id: data.id,
      type: (data.type as 'fiat_gateway_order' | 'withdrawal') || 'fiat_gateway_order',
      status: data.status,
      ...data,
    },
  };
}

/**
 * Map Foxbit webhook status to internal payment states.
 * Based on official Fiat Gateway order lifecycle.
 */
export function mapWebhookStatusToPaymentState(
  eventType: string,
  status: string,
): 'PIX_CONFIRMED' | 'CONVERSION_PENDING' | 'SETTLED' | 'FAILED' | 'UNKNOWN' {
  if (eventType === 'status_change') {
    switch (status) {
      case 'PAID':
      case 'CONFIRMED':
        return 'PIX_CONFIRMED';
      case 'PROCESSING':
      case 'CONVERTING':
        return 'CONVERSION_PENDING';
      case 'COMPLETED':
      case 'SETTLED':
        return 'SETTLED';
      case 'FAILED':
      case 'REJECTED':
      case 'CANCELED':
      case 'EXPIRED':
        return 'FAILED';
      default:
        return 'UNKNOWN';
    }
  }
  return 'UNKNOWN';
}

/**
 * Composite handler for Foxbit Partner API v3 webhooks.
 * Verifies signature, parses event, deduplicates by event_id,
 * maps status, and returns a structured result for the route handler.
 */
export async function handleFoxbitWebhookEvent(params: {
  rawBody: Buffer;
  signature: string;
  webhookSecret: string;
}): Promise<{
  accepted: boolean;
  duplicate: boolean;
  eventId: string | null;
  eventType: string | null;
  paymentUpdated: boolean;
}> {
  const { rawBody, signature, webhookSecret } = params;

  // 1. Verify signature
  if (!verifyFoxbitWebhook(rawBody, signature, webhookSecret)) {
    return { accepted: false, duplicate: false, eventId: null, eventType: null, paymentUpdated: false };
  }

  // 2. Parse payload
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { accepted: false, duplicate: false, eventId: null, eventType: null, paymentUpdated: false };
  }

  const event = parseFoxbitWebhook(body);
  if (!event) {
    return { accepted: false, duplicate: false, eventId: null, eventType: null, paymentUpdated: false };
  }

  // 3. Deduplication is handled at the route level via Prisma unique constraint on providerEventId.
  // This function returns the parsed event so the route can persist + process atomically.
  const mappedState = mapWebhookStatusToPaymentState(event.event_type, event.data.status);

  return {
    accepted: true,
    duplicate: false,
    eventId: event.event_id,
    eventType: event.event_type,
    paymentUpdated: mappedState !== 'UNKNOWN',
  };
}