import { expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { mapWebhookStatusToPaymentState, parseFoxbitWebhook, verifyFoxbitWebhook } from './foxbit-webhook.js';

it('Foxbit V2 signature verifies raw bytes and rejects tampering', () => {
  const raw = Buffer.from('{"event_id":"evt-1","webhook_type":"status_change"}');
  const secret = 'foxbit-webhook-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  expect(verifyFoxbitWebhook(raw, signature, secret)).toBe(true);
  expect(verifyFoxbitWebhook(Buffer.from(raw.toString() + ' '), signature, secret)).toBe(false);
  expect(verifyFoxbitWebhook(raw, 'not-hex', secret)).toBe(false);
});

it('Foxbit parser accepts documented Gateway envelope fields', () => {
  const parsed = parseFoxbitWebhook({ event_id: 'evt-123', webhook_type: 'status_change', timestamp: 1709234676472, data: { purchase_id: 'order-123', from_state: 'CREATED', to_state: 'PAID' } });
  expect(parsed?.event_id).toBe('evt-123');
  expect(parsed?.data.purchase_id).toBe('order-123');
  expect(parsed?.data.to_state).toBe('PAID');
  expect(parseFoxbitWebhook({ id: 'old', type: 'status_change', data: { id: 'x', status: 'PAID' } })).toBeNull();
});

it('Foxbit PAID confirms PIX but FINISHED is not PixSplit payout completion', () => {
  expect(mapWebhookStatusToPaymentState('status_change', 'PAID')).toBe('PIX_CONFIRMED');
  expect(mapWebhookStatusToPaymentState('status_change', 'FINISHED')).toBe('SETTLED');
  expect(mapWebhookStatusToPaymentState('status_change', 'CANCELED')).toBe('FAILED');
  expect(mapWebhookStatusToPaymentState('travel_rule_status_change', 'PAID')).toBe('UNKNOWN');
});