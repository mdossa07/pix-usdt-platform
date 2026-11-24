import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';

export interface TransFiWebhookEvent {
  eventId: string;
  entityId?: string;
  entityType?: string;
  status?: string;
  orderType?: string;
  data?: unknown;
  createdAt?: string;
}

export class TransFiWebhookError extends Error {
  constructor(message: string) { super(message); this.name = 'TransFiWebhookError'; }
}

export function verifyTransFiWebhookSignature(rawBody: string | Buffer, signature: string | undefined, secret = config.TRANSFI_WEBHOOK_SECRET): void {
  if (!secret) throw new TransFiWebhookError('TRANSFI_WEBHOOK_SECRET is not configured');
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) throw new TransFiWebhookError('Missing or invalid X-Transfi-Hmac-Hash header');
  const payload = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = Buffer.from(signature, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) throw new TransFiWebhookError('Webhook signature verification failed');
}

export function parseTransFiWebhook(rawBody: string | Buffer): TransFiWebhookEvent {
  const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new TransFiWebhookError('Invalid webhook JSON payload'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TransFiWebhookError('Webhook payload is not an object');
  const event = parsed as Record<string, unknown>;
  // v3 uses eventId/entityId/entityType. Keep legacy id/type as migration fallbacks.
  const eventId = typeof event.eventId === 'string' ? event.eventId : event.id;
  const entityId = typeof event.entityId === 'string' ? event.entityId : undefined;
  const entityType = typeof event.entityType === 'string' ? event.entityType : typeof event.type === 'string' ? event.type : undefined;
  const order = event.order && typeof event.order === 'object' ? event.order as Record<string, unknown> : undefined;
  if (typeof eventId !== 'string' || !eventId) throw new TransFiWebhookError('Webhook payload missing eventId');
  return {
    eventId, entityId, entityType,
    status: typeof event.status === 'string' ? event.status : undefined,
    orderType: typeof order?.type === 'string' ? order.type : undefined,
    data: event, createdAt: typeof event.createdAt === 'string' ? event.createdAt : undefined,
  };
}

export type PaymentStateFromWebhook = 'PAID' | 'FAILED' | 'PENDING' | 'COMPLETED' | null;
export function mapTransFiStatusToPaymentState(status: string | undefined): PaymentStateFromWebhook {
  if (!status) return null;
  switch (status.toLowerCase()) {
    case 'fund_settled': return 'PAID';
    case 'fund_failed':
    case 'failed':
    case 'cancelled':
    case 'expired': return 'FAILED';
    case 'initiated':
    case 'fund_processing':
    case 'manual_review':
    case 'pending':
    case 'processing':
    case 'created': return 'PENDING';
    case 'asset_settled':
    case 'completed': return 'COMPLETED';
    default: return null;
  }
}