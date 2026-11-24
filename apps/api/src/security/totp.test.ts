import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTotpProvisioningUri,
  encodeBase32,
  generateTotpSecret,
  matchTotpCounter,
  verifyTotp,
} from './totp.js';

test('generates a 160-bit base32 secret', () => {
  const first = generateTotpSecret();
  const second = generateTotpSecret();
  assert.match(first, /^[A-Z2-7]{32}$/);
  assert.notEqual(first, second);
});

test('encodes base32 using RFC alphabet without padding', () => {
  assert.equal(encodeBase32(Buffer.from('foobar', 'utf8')), 'MZXW6YTBOI');
});

test('validates RFC 6238 SHA-1 TOTP six-digit vector', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(verifyTotp(secret, '287082', 59_000, 0), true);
  assert.equal(matchTotpCounter(secret, '287082', 59_000, 0), 1);
  assert.equal(verifyTotp(secret, '287083', 59_000, 0), false);
});

test('allows one 30-second step of clock drift', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(verifyTotp(secret, '287082', 89_000, 1), true);
  assert.equal(verifyTotp(secret, '287082', 120_000, 1), false);
});

test('rejects malformed codes and invalid secrets', () => {
  assert.equal(verifyTotp('not-base32!', '287082', 59_000), false);
  assert.equal(verifyTotp('GEZDGNBVGY3TQOJQ', '287082', 59_000), false);
  assert.equal(verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '28708', 59_000), false);
});

test('builds a standard authenticator provisioning URI', () => {
  const uri = buildTotpProvisioningUri('admin@example.com', 'ABC234', 'PixSplit');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=ABC234/);
  assert.match(uri, /issuer=PixSplit/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
