import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBrowserApiBaseUrl } from '../../web/lib/api-url.js';

test('uses the local HTTP default outside production', () => {
  assert.equal(resolveBrowserApiBaseUrl(undefined, 'development'), 'http://localhost:4000');
  assert.equal(resolveBrowserApiBaseUrl(undefined, 'test'), 'http://localhost:4000');
  assert.equal(resolveBrowserApiBaseUrl('http://127.0.0.1:4000/', 'development'), 'http://127.0.0.1:4000');
});

test('requires an explicit HTTPS API URL in production', () => {
  assert.throws(() => resolveBrowserApiBaseUrl(undefined, 'production'), /PRODUCTION_NEXT_PUBLIC_API_URL_REQUIRED/);
  assert.throws(
    () => resolveBrowserApiBaseUrl('http://api.pixsplit.example', 'production'),
    /PRODUCTION_NEXT_PUBLIC_API_URL_MUST_USE_HTTPS/,
  );
  assert.equal(
    resolveBrowserApiBaseUrl('https://api.pixsplit.example/v1-root/', 'production'),
    'https://api.pixsplit.example/v1-root',
  );
});

test('rejects credentials, query strings and unsupported schemes', () => {
  assert.throws(() => resolveBrowserApiBaseUrl('https://user:pass@api.example', 'development'), /NEXT_PUBLIC_API_URL_MUST_NOT_CONTAIN_CREDENTIALS/);
  assert.throws(() => resolveBrowserApiBaseUrl('ftp://api.example', 'development'), /NEXT_PUBLIC_API_URL_MUST_USE_HTTP_OR_HTTPS/);
  assert.throws(() => resolveBrowserApiBaseUrl('https://api.example?token=x', 'development'), /NEXT_PUBLIC_API_URL_MUST_NOT_CONTAIN_QUERY_OR_FRAGMENT/);
});
