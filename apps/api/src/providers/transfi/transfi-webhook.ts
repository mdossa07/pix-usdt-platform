import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';

export interface TransFiWebhookEvent {
 id: string;
 type: string;
 entityId?: string;
 status?: string;
 data?: unknown;
 createdAt?: string;
}

export class TransFiWebhookError extends Error {
 constructor(message: string) {
 super(message);
 this.name = 'TransFiWebhookError';
 }
}

export function verifyTransFiWebhookSignature(
 rawBody: string | Buffer,
 signature: string | undefined,
): void {
 const secret = config.TRANSFI_WEBHOOK_SECRET;
 if (!secret) {
 throw new TransFiWebhookError('TRANSFI_WEBHOOK_SECRET is not configured');
 }

 if (!signature) {
 throw new TransFiWebhookError('Missing X-Transfi-Hmac-Hash header');
 }

 const payload = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
 const expected = createHmac('sha256', secret).update(payload).digest('hex');

 let sigBuffer: Buffer;
 try {
 sigBuffer = Buffer.from(signature, 'hex');
 } catch {
 throw new TransFiWebhookError('Invalid signature encoding');
 }

 const expectedBuffer = Buffer.from(expected, 'hex');
 if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
 throw new TransFiWebhookError('Webhook signature verification failed');
 }
}

export function parseTransFiWebhook(rawBody: string | Buffer): TransFiWebhookEvent {
 const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
 let parsed: unknown;
 try {
 parsed = JSON.parse(text);
 } catch {
 throw new TransFiWebhookError('Invalid webhook JSON payload');
 }

 if (!parsed || typeof parsed !== 'object') {
 throw new TransFiWebhookError('Webhook payload is not an object');
 }

 const event = parsed as Record<string, unknown>;
 if (typeof event.id !== 'string' || typeof event.type !== 'string') {
 throw new TransFiWebhookError('Webhook payload missing required id or type fields');
 }

 return {
 id: event.id,
 type: event.type,
 entityId: typeof event.entityId === 'string' ? event.entityId : undefined,
 status: typeof event.status === 'string' ? event.status : undefined,
 data: event.data,
 createdAt: typeof event.createdAt === 'string' ? event.createdAt : undefined,
 };
}

export type PaymentStateFromWebhook = 'PAID' | 'COMPLETED' | 'FAILED' | 'PENDING' | null;

export function mapTransFiStatusToPaymentState(status: string | undefined): PaymentStateFromWebhook {
 if (!status) return null;
 switch (status) {
 case 'fund_settled':
 return 'PAID';
 case 'asset_settled':
 return 'COMPLETED';
 case 'failed':
 case 'cancelled':
 case 'expired':
 return 'FAILED';
 case 'pending':
 case 'processing':
 case 'created':
 return 'PENDING';
 default:
 return null;
 }
}