import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mapWebhookStatusToPaymentState, parseFoxbitWebhook, verifyFoxbitWebhook } from './foxbit-webhook.js';

test('Foxbit V2 signature verifies raw bytes and rejects tampering', () => {
  const raw = Buffer.from('{"event_id":"evt-1","webhook_type":"status_change"}');
  const secret = 'foxbit-webhook-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifyFoxbitWebhook(raw, signature, secret), true);
  assert.equal(verifyFoxbitWebhook(Buffer.from(raw.toString() + ' '), signature, secret), false);
  assert.equal(verifyFoxbitWebhook(raw, 'not-hex', secret), false);
});

test('Foxbit parser accepts documented Gateway envelope fields', () => {
  const parsed = parseFoxbitWebhook({ event_id: 'evt-123', webhook_type: 'status_change', timestamp: 1709234676472, data: { purchase_id: 'order-123', from_state: 'CREATED', to_state: 'PAID' } });
  assert.equal(parsed?.event_id, 'evt-123');
  assert.equal(parsed?.data.purchase_id, 'order-123');
  assert.equal(parsed?.data.to_state, 'PAID');
  assert.equal(parseFoxbitWebhook({ id: 'old', type: 'status_change', data: { id: 'x', status: 'PAID' } }), null);
});

test('Foxbit PAID confirms PIX but FINISHED is not PixSplit payout completion', () => {
  assert.equal(mapWebhookStatusToPaymentState('status_change', 'PAID'), 'PIX_CONFIRMED');
  assert.equal(mapWebhookStatusToPaymentState('status_change', 'FINISHED'), 'SETTLED');
  assert.equal(mapWebhookStatusToPaymentState('status_change', 'CANCELED'), 'FAILED');
  assert.equal(mapWebhookStatusToPaymentState('travel_rule_status_change', 'PAID'), 'UNKNOWN');
});