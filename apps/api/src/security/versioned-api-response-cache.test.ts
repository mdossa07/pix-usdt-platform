import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVersionedApiResponseCachePolicy,
  isVersionedApiRoute,
} from './versioned-api-response-cache.js';

test('matches nested versioned API paths while ignoring query strings', () => {
  assert.equal(isVersionedApiRoute('/v1/admin/payments'), true);
  assert.equal(isVersionedApiRoute('/v1/admin/payment-reservations/pending?take=10'), true);
  assert.equal(isVersionedApiRoute('/v1/merchant/payments'), true);
  assert.equal(isVersionedApiRoute('/v1/auth/sessions?includeCurrent=true'), true);
  assert.equal(isVersionedApiRoute('/v1/me'), true);
  assert.equal(isVersionedApiRoute('/v1/checkout/abc'), true);
});

test('does not match non-versioned endpoints or similar prefixes', () => {
  assert.equal(isVersionedApiRoute('/health'), false);
  assert.equal(isVersionedApiRoute('/metrics'), false);
  assert.equal(isVersionedApiRoute('/assets/app.js'), false);
  assert.equal(isVersionedApiRoute('/v10/admin/payments'), false);
  assert.equal(isVersionedApiRoute('/v1'), false);
});

test('sets no-store and no-cache on all versioned API responses', () => {
  for (const url of [
    '/v1/admin/payments?status=PENDING',
    '/v1/merchant/payments',
    '/v1/auth/sessions?take=20',
  ]) {
    const headers = new Map<string, string>();
    const setHeader = (name: string, value: string) => headers.set(name, value);

    applyVersionedApiResponseCachePolicy(url, setHeader);
    assert.equal(headers.get('Cache-Control'), 'no-store', url);
    assert.equal(headers.get('Pragma'), 'no-cache', url);
  }
});

test('does not set cache headers on health, metrics, or static responses', () => {
  for (const url of ['/health', '/metrics', '/assets/app.js']) {
    const headers = new Map<string, string>();
    applyVersionedApiResponseCachePolicy(url, (name, value) => headers.set(name, value));
    assert.equal(headers.size, 0, url);
  }
});
