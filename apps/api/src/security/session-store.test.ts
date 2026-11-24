import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthSessionActive } from './session-store.js';

const now = new Date('2026-11-24T23:40:00.000Z');
const activeSession = {
  userId: 'user-1',
  expiresAt: new Date('2026-11-24T23:50:00.000Z'),
  revokedAt: null,
};

test('accepts only a non-revoked session owned by the authenticated user', () => {
  assert.equal(isAuthSessionActive(activeSession, 'user-1', now), true);
  assert.equal(isAuthSessionActive(activeSession, 'user-2', now), false);
});

test('rejects missing and revoked sessions', () => {
  assert.equal(isAuthSessionActive(null, 'user-1', now), false);
  assert.equal(isAuthSessionActive(undefined, 'user-1', now), false);
  assert.equal(isAuthSessionActive({ ...activeSession, revokedAt: now }, 'user-1', now), false);
});

test('rejects expired sessions and the exact expiry boundary', () => {
  assert.equal(isAuthSessionActive({ ...activeSession, expiresAt: new Date(now.getTime() - 1) }, 'user-1', now), false);
  assert.equal(isAuthSessionActive({ ...activeSession, expiresAt: now }, 'user-1', now), false);
});

test('rejects invalid expiry and clock values', () => {
  assert.equal(isAuthSessionActive({ ...activeSession, expiresAt: new Date(Number.NaN) }, 'user-1', now), false);
  assert.equal(isAuthSessionActive(activeSession, 'user-1', new Date(Number.NaN)), false);
});
