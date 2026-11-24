import { expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { mapTransFiStatusToPaymentState, parseTransFiWebhook, verifyTransFiWebhookSignature } from './transfi-webhook.js';

it('TransFi HMAC verifies raw bytes and rejects altered payloads', () => {
  const raw = Buffer.from('{"eventId":"EV-1","entityId":"OR-1","entityType":"order","status":"fund_settled"}');
  const secret = 'transfi-webhook-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  expect(() => verifyTransFiWebhookSignature(raw, signature, secret)).not.toThrow();
  expect(() => verifyTransFiWebhookSignature(Buffer.from(raw.toString() + ' '), signature, secret)).toThrow();
  expect(() => verifyTransFiWebhookSignature(raw, 'bad', secret)).toThrow();
});

it('TransFi v3 parser normalizes eventId/entityId/entityType/order.type', () => {
  const parsed = parseTransFiWebhook(JSON.stringify({ eventId: 'EV-123', entityId: 'OR-456', entityType: 'order', status: 'fund_settled', order: { orderId: 'OR-456', type: 'payin' } }));
  expect(parsed.eventId).toBe('EV-123');
  expect(parsed.entityId).toBe('OR-456');
  expect(parsed.entityType).toBe('order');
  expect(parsed.orderType).toBe('payin');
});

it('TransFi PIX event map follows collection statuses', () => {
  expect(mapTransFiStatusToPaymentState('fund_settled')).toBe('PAID');
  expect(mapTransFiStatusToPaymentState('fund_failed')).toBe('FAILED');
  expect(mapTransFiStatusToPaymentState('fund_processing')).toBe('PENDING');
  expect(mapTransFiStatusToPaymentState('manual_review')).toBe('PENDING');
});