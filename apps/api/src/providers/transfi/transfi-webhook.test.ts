import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mapTransFiStatusToPaymentState, parseTransFiWebhook, verifyTransFiWebhookSignature } from './transfi-webhook.js';

test('TransFi HMAC verifies raw bytes and rejects altered payloads', () => {
  const raw = Buffer.from('{"eventId":"EV-1","entityId":"OR-1","entityType":"order","status":"fund_settled"}');
  const secret = 'transfi-webhook-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.doesNotThrow(() => verifyTransFiWebhookSignature(raw, signature, secret));
  assert.throws(() => verifyTransFiWebhookSignature(Buffer.from(raw.toString() + ' '), signature, secret));
  assert.throws(() => verifyTransFiWebhookSignature(raw, 'bad', secret));
});

test('TransFi v3 parser normalizes eventId/entityId/entityType/order.type', () => {
  const parsed = parseTransFiWebhook(JSON.stringify({ eventId: 'EV-123', entityId: 'OR-456', entityType: 'order', status: 'fund_settled', order: { orderId: 'OR-456', type: 'payin' } }));
  assert.equal(parsed.eventId, 'EV-123');
  assert.equal(parsed.entityId, 'OR-456');
  assert.equal(parsed.entityType, 'order');
  assert.equal(parsed.orderType, 'payin');
});

test('TransFi PIX event map follows collection statuses', () => {
  assert.equal(mapTransFiStatusToPaymentState('fund_settled'), 'PAID');
  assert.equal(mapTransFiStatusToPaymentState('fund_failed'), 'FAILED');
  assert.equal(mapTransFiStatusToPaymentState('fund_processing'), 'PENDING');
  assert.equal(mapTransFiStatusToPaymentState('manual_review'), 'PENDING');
});
test('TransFi v3 webhook status mapping covers intermediate and terminal failure events', () => {
  for (const status of ['fund_deposited', 'asset_deposited', 'asset_processing', 'approval_pending', 'manual_review']) {
    assert.equal(mapTransFiStatusToPaymentState(status), 'PENDING', status);
  }
  for (const status of ['fund_deposit_failed', 'asset_settle_failed', 'rejected', 'expired']) {
    assert.equal(mapTransFiStatusToPaymentState(status), 'FAILED', status);
  }
  assert.equal(mapTransFiStatusToPaymentState('asset_settled'), 'COMPLETED');
});
