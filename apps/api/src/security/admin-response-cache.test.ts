import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAdminResponseCachePolicy, isAdminApiRoute } from './admin-response-cache.js';

test('matches nested admin API paths while ignoring query strings', () => {
  assert.equal(isAdminApiRoute('/v1/admin/payments'), true);
  assert.equal(isAdminApiRoute('/v1/admin/payment-reservations/pending?take=10'), true);
  assert.equal(isAdminApiRoute('/v1/admin/2fa/status?source=panel'), true);
});

test('does not match merchant, public, or similarly prefixed non-admin paths', () => {
  assert.equal(isAdminApiRoute('/v1/merchant/payments'), false);
  assert.equal(isAdminApiRoute('/v1/checkout/abc'), false);
  assert.equal(isAdminApiRoute('/v1/administrator/payments'), false);
  assert.equal(isAdminApiRoute('/health'), false);
});

test('sets no-store and no-cache only for admin API responses', () => {
  const headers = new Map<string, string>();
  const setHeader = (name: string, value: string) => headers.set(name, value);

  applyAdminResponseCachePolicy('/v1/admin/payments?status=PENDING', setHeader);
  assert.equal(headers.get('Cache-Control'), 'no-store');
  assert.equal(headers.get('Pragma'), 'no-cache');

  headers.clear();
  applyAdminResponseCachePolicy('/v1/merchant/payments', setHeader);
  assert.equal(headers.size, 0);
});
