import test from 'node:test';
import assert from 'node:assert/strict';
import { canBeDefaultDestination } from './wallet-eligibility.js';

test('only a fully verified wallet can become the default destination', () => {
  assert.equal(canBeDefaultDestination('VERIFIED', true), true);
  assert.equal(canBeDefaultDestination('VERIFIED', false), false);
  assert.equal(canBeDefaultDestination('PENDING_VERIFICATION', false), false);
  assert.equal(canBeDefaultDestination('REJECTED', false), false);
  assert.equal(canBeDefaultDestination('DISABLED', false), false);
});

test('inconsistent persisted verification state fails closed', () => {
  assert.equal(canBeDefaultDestination('PENDING_VERIFICATION', true), false);
  assert.equal(canBeDefaultDestination('REJECTED', true), false);
  assert.equal(canBeDefaultDestination('DISABLED', true), false);
});
