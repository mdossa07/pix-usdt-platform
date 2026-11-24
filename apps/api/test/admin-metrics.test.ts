import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateSettledCommissionUnits,
  countActionablePayments,
  formatUsdtUnits,
} from '../../web/lib/admin-metrics.js';

test('counts only completed platform commission transfers using exact 8-decimal units', () => {
  const payments = [
    { status: 'COMPLETED', transfers: [
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: '2.00000001' },
      { kind: 'MERCHANT_PAYOUT', status: 'COMPLETED', amountUsdt: '98.00000000' },
    ] },
    { status: 'MERCHANT_PAYOUT_PENDING', transfers: [
      { kind: 'PLATFORM_COMMISSION', status: 'PROCESSING', amountUsdt: '1.50000000' },
    ] },
    { status: 'UNDER_REVIEW', transfers: [] },
    { status: 'FAILED', transfers: [
      { kind: 'PLATFORM_COMMISSION', status: 'FAILED', amountUsdt: '3.00000000' },
    ] },
  ];
  assert.equal(calculateSettledCommissionUnits(payments), 200_000_001n);
});

test('ignores malformed or non-positive settled transfer amounts', () => {
  const payments = [
    { status: 'COMPLETED', transfers: [
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: 'not-a-number' },
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: '-1' },
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: '0' },
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: '1.123456789' },
    ] },
  ];
  assert.equal(calculateSettledCommissionUnits(payments), 0n);
});

test('formats exact USDT units without binary floating-point arithmetic', () => {
  assert.equal(formatUsdtUnits(123_456_789n), '1,2346');
  assert.equal(formatUsdtUnits(12_345_678_901n), '123,4568');
  assert.equal(formatUsdtUnits(100_000_000n, 8), '1,00000000');
});

test('does not count terminal or normal PIX-awaiting payments as pending internal operations', () => {
  const payments = [
    { status: 'CREATED', transfers: [] },
    { status: 'UNDER_REVIEW', transfers: [] },
    { status: 'COMPLETED', transfers: [] },
    { status: 'FAILED', transfers: [] },
    { status: 'CANCELED', transfers: [] },
    { status: 'EXPIRED', transfers: [] },
    { status: 'PIX_PENDING', transfers: [] },
  ];
  assert.equal(countActionablePayments(payments), 2);
});
