import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSettledCommission, countActionablePayments } from '../../web/lib/admin-metrics.js';

test('counts commission only after the platform transfer is confirmed', () => {
  const payments = [
    { status: 'COMPLETED', commissionUsdt: '2.00', platformTransferStatus: 'COMPLETED' },
    { status: 'MERCHANT_PAYOUT_PENDING', commissionUsdt: '1.50', platformTransferStatus: 'PROCESSING' },
    { status: 'UNDER_REVIEW', commissionUsdt: '4.00', platformTransferStatus: null },
    { status: 'FAILED', commissionUsdt: '3.00', platformTransferStatus: 'FAILED' },
    { status: 'COMPLETED', commissionUsdt: null, platformTransferStatus: 'COMPLETED' },
  ];
  assert.equal(calculateSettledCommission(payments), 2);
});

test('ignores malformed or non-positive commission values', () => {
  const payments = [
    { status: 'COMPLETED', commissionUsdt: 'not-a-number', platformTransferStatus: 'COMPLETED' },
    { status: 'COMPLETED', commissionUsdt: '-1', platformTransferStatus: 'COMPLETED' },
  ];
  assert.equal(calculateSettledCommission(payments), 0);
});

test('does not count terminal or normal PIX-awaiting payments as stuck operations', () => {
  const payments = [
    { status: 'CREATED', commissionUsdt: null, platformTransferStatus: null },
    { status: 'UNDER_REVIEW', commissionUsdt: null, platformTransferStatus: null },
    { status: 'COMPLETED', commissionUsdt: null, platformTransferStatus: 'COMPLETED' },
    { status: 'FAILED', commissionUsdt: null, platformTransferStatus: 'FAILED' },
    { status: 'CANCELED', commissionUsdt: null, platformTransferStatus: null },
    { status: 'EXPIRED', commissionUsdt: null, platformTransferStatus: null },
    { status: 'PIX_PENDING', commissionUsdt: null, platformTransferStatus: null },
  ];
  assert.equal(countActionablePayments(payments), 2);
});
