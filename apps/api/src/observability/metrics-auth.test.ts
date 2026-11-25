import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidMetricsBearerToken } from './metrics-auth.js';

const secret = 'a'.repeat(48);

test('accepts the exact configured Bearer token', () => {
  assert.equal(isValidMetricsBearerToken(`Bearer ${secret}`, secret), true);
});

test('rejects missing, malformed and incorrect credentials', () => {
  assert.equal(isValidMetricsBearerToken(undefined, secret), false);
  assert.equal(isValidMetricsBearerToken('Basic token', secret), false);
  assert.equal(isValidMetricsBearerToken(`Bearer ${'b'.repeat(48)}`, secret), false);
  assert.equal(isValidMetricsBearerToken(`bearer ${secret}`, secret), false);
  assert.equal(isValidMetricsBearerToken(`Bearer ${secret} `, secret), false);
});

test('refuses weak, malformed or oversized configured secrets', () => {
  assert.equal(isValidMetricsBearerToken('Bearer short', 'short'), false);
  assert.equal(isValidMetricsBearerToken(`Bearer ${secret}`, 'short'), false);
  assert.equal(isValidMetricsBearerToken(`Bearer ${secret}`, 'x'.repeat(257)), false);
  assert.equal(isValidMetricsBearerToken(`Bearer ${secret}`, 'a'.repeat(47) + '\n'), false);
});
