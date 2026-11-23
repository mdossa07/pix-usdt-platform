import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateUsdtSplit, mockBrlToUsdt } from './split.js';

// Unit tests for the financial core that the orchestrator depends on.
// These validate exact integer arithmetic and floor-rounding behavior.

test('mockBrlToUsdt converts cents to USDT string without float', () => {
  // 100.50 BRL at rate 0.18 => 18.090000 USDT
  const result = mockBrlToUsdt(10050n, '0.18');
  assert.equal(result, '18.090000');
});

test('mockBrlToUsdt handles zero amount', () => {
  assert.equal(mockBrlToUsdt(0n, '0.18'), '0.000000');
});

test('calculateUsdtSplit enforces exact 98/2 division with integer arithmetic', () => {
  const split = calculateUsdtSplit('100.000000', 200);
  assert.equal(split.totalUsdt, '100.000000');
  assert.equal(split.merchantUsdt, '98.000000');
  assert.equal(split.commissionUsdt, '2.000000');
  assert.equal(split.commissionBps, 200);
});

test('calculateUsdtSplit floors commission (protects merchant) and preserves total', () => {
  // 0.000099 USDT * 2% = 0.00000198 → floors to 0.000001
  const split = calculateUsdtSplit('0.000099', 200);
  assert.equal(split.commissionUsdt, '0.000001');
  assert.equal(split.merchantUsdt, '0.000098');
  // Verify conservation: merchant + commission == total
  const sumUnits = BigInt(split.merchantUsdt.replace('.', '')) + BigInt(split.commissionUsdt.replace('.', ''));
  const totalUnits = BigInt(split.totalUsdt.replace('.', ''));
  assert.equal(sumUnits, totalUnits);
});

test('calculateUsdtSplit rejects non-integer bps', () => {
  // Non-integer bps is caught before amount parsing
  assert.throws(() => calculateUsdtSplit('10.000000', 200.5), /commissionBps must be an integer/);
});

test('calculateUsdtSplit rejects negative amounts', () => {
  // Negative sign fails regex in parseTokenUnits before the >0 check
  assert.throws(() => calculateUsdtSplit('-1.000000', 200), /Invalid decimal amount/);
});

test('merchant + commission always equals total (no rounding leak)', () => {
  const amounts = ['0.000001', '0.000003', '1.000000', '99.999999', '123456.789012'];
  for (const amt of amounts) {
    const s = calculateUsdtSplit(amt, 200);
    const sum = BigInt(s.merchantUsdt.replace('.', '')) + BigInt(s.commissionUsdt.replace('.', ''));
    const totalRaw = BigInt(s.totalUsdt.replace('.', ''));
    assert.equal(sum, totalRaw, `Rounding leak for ${amt}`);
  }
});