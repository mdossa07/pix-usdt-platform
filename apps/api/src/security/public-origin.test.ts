import assert from 'node:assert/strict';
import test from 'node:test';
import { getPublicAppOrigin } from './public-origin.js';

test('allows localhost HTTP origins in development and test environments', () => {
  assert.equal(getPublicAppOrigin('development', 'http://localhost:3000/path'), 'http://localhost:3000');
  assert.equal(getPublicAppOrigin('test', 'http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
});

test('requires HTTPS for the browser application origin in production', () => {
  assert.throws(
    () => getPublicAppOrigin('production', 'http://app.pixsplit.example'),
    /PRODUCTION_APP_URL_MUST_USE_HTTPS/,
  );
  assert.equal(getPublicAppOrigin('production', 'https://app.pixsplit.example/admin'), 'https://app.pixsplit.example');
});

test('rejects credentials and unsupported schemes in all environments', () => {
  assert.throws(() => getPublicAppOrigin('development', 'https://user:pass@example.test'), /APP_URL_MUST_NOT_CONTAIN_CREDENTIALS/);
  assert.throws(() => getPublicAppOrigin('development', 'ftp://app.example.test'), /APP_URL_MUST_USE_HTTP_OR_HTTPS/);
  assert.throws(() => getPublicAppOrigin('production', 'not-a-url'), /APP_URL_MUST_BE_ABSOLUTE_URL/);
});
