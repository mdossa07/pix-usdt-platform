import test from 'node:test';
import assert from 'node:assert/strict';
import { transferAttemptIdempotencyKey } from './transfer-attempt.js';

test('each transfer leg gets a distinct stable idempotency reference', () => {
  assert.equal(
    transferAttemptIdempotencyKey('pay_123', 'MERCHANT_PAYOUT', 1),
    'pay_123:merchant:v1',
  );
  assert.equal(
    transferAttemptIdempotencyKey('pay_123', 'PLATFORM_COMMISSION', 1),
    'pay_123:platform:v1',
  );
});

test('a confirmed terminal retry advances the attempt reference', () => {
  assert.equal(
    transferAttemptIdempotencyKey('pay_123', 'MERCHANT_PAYOUT', 2),
    'pay_123:merchant:v2',
  );
  assert.notEqual(
    transferAttemptIdempotencyKey('pay_123', 'PLATFORM_COMMISSION', 1),
    transferAttemptIdempotencyKey('pay_123', 'PLATFORM_COMMISSION', 2),
  );
});

test('invalid attempt numbers are rejected', () => {
  assert.throws(() => transferAttemptIdempotencyKey('pay_123', 'MERCHANT_PAYOUT', 0));
  assert.throws(() => transferAttemptIdempotencyKey('pay_123', 'MERCHANT_PAYOUT', 1.5));
});
