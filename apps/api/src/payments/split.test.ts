import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateUsdtSplit, mockBrlToUsdt } from './split.js';

test('splits 2% commission in USDT without float arithmetic', () => {
  assert.deepEqual(calculateUsdtSplit('100.000000', 200), {
    totalUsdt: '100.000000', commissionUsdt: '2.000000', merchantUsdt: '98.000000', commissionBps: 200, precision: 6,
  });
});

test('uses exact integer arithmetic for a mock BRL conversion and 98/2 split', () => {
  const gross = mockBrlToUsdt(100_000n, '0.180000');
  assert.equal(gross, '180.000000');
  const split = calculateUsdtSplit(gross, 200);
  assert.equal(split.commissionUsdt, '3.600000');
  assert.equal(split.merchantUsdt, '176.400000');
});

test('rounds commission down to token precision and keeps totals balanced', () => {
  const result = calculateUsdtSplit('0.000099', 200);
  assert.equal(result.commissionUsdt, '0.000001');
  assert.equal(result.merchantUsdt, '0.000098');
  assert.equal(result.commissionUsdt, formatAdd(result.totalUsdt, result.merchantUsdt));
});

function formatAdd(a: string, b: string): string {
  const toUnits = (s: string) => BigInt(s.replace('.', ''));
  const sum = toUnits(a) + toUnits(b);
  return `${sum / 1_000_000n}.${(sum % 1_000_000n).toString().padStart(6, '0')}`;
}

test('rejects excessive precision and negative/non-numeric amounts', () => {
  assert.throws(() => calculateUsdtSplit('1.0000001', 200));
  assert.throws(() => calculateUsdtSplit('-1', 200));
  assert.throws(() => calculateUsdtSplit('abc', 200));
});
