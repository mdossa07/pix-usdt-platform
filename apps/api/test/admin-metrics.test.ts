import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSettledCommission, countActionablePayments } from '../../web/lib/admin-metrics.js';

test('counts only completed platform commission transfers', () => {
  const payments = [
    { status: 'COMPLETED', transfers: [
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: '2.00' },
      { kind: 'MERCHANT_PAYOUT', status: 'COMPLETED', amountUsdt: '98.00' },
    ] },
    { status: 'MERCHANT_PAYOUT_PENDING', transfers: [
      { kind: 'PLATFORM_COMMISSION', status: 'PROCESSING', amountUsdt: '1.50' },
    ] },
    { status: 'UNDER_REVIEW', transfers: [] },
    { status: 'FAILED', transfers: [
      { kind: 'PLATFORM_COMMISSION', status: 'FAILED', amountUsdt: '3.00' },
    ] },
  ];
  assert.equal(calculateSettledCommission(payments), 2);
});

test('ignores malformed or non-positive settled transfer amounts', () => {
  const payments = [
    { status: 'COMPLETED', transfers: [
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: 'not-a-number' },
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: '-1' },
      { kind: 'PLATFORM_COMMISSION', status: 'COMPLETED', amountUsdt: '0' },
    ] },
  ];
  assert.equal(calculateSettledCommission(payments), 0);
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
