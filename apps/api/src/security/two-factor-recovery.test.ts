import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRecoveryCodes, hashRecoveryCode, isRecoveryCode } from './two-factor-recovery.js';

test('generates ten distinct high-entropy recovery codes', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(codes.every(code => /^[A-F0-9]{16}$/.test(code)));
});

test('hashes recovery codes and accepts only the expected format', () => {
  const code = '0123456789ABCDEF';
  assert.equal(isRecoveryCode(code), true);
  assert.equal(isRecoveryCode(code.toLowerCase()), true);
  assert.equal(isRecoveryCode('0123456789ABCDE'), false);
  assert.equal(isRecoveryCode('0123456789ABCDEFG'), false);
  assert.equal(hashRecoveryCode(code).length, 64);
  assert.notEqual(hashRecoveryCode(code), code);
});

test('rejects invalid recovery code generation counts', () => {
  assert.throws(() => generateRecoveryCodes(0), /invalid_recovery_code_count/);
  assert.throws(() => generateRecoveryCodes(21), /invalid_recovery_code_count/);
});
