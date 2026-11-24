import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStatus, TransferStatus } from '@prisma/client';
import { derivePaymentAggregateStatus } from './payment-status.js';

test('payment completes only when both independent payout legs complete', () => {
  assert.equal(
    derivePaymentAggregateStatus(TransferStatus.COMPLETED, TransferStatus.COMPLETED),
    PaymentStatus.COMPLETED,
  );
});

test('one completed payout keeps the other leg explicitly pending', () => {
  assert.equal(
    derivePaymentAggregateStatus(TransferStatus.COMPLETED, TransferStatus.PROCESSING),
    PaymentStatus.PLATFORM_PAYOUT_PENDING,
  );
  assert.equal(
    derivePaymentAggregateStatus(TransferStatus.PROCESSING, TransferStatus.COMPLETED),
    PaymentStatus.MERCHANT_PAYOUT_PENDING,
  );
});

test('failed or ambiguous payout outcomes require review', () => {
  assert.equal(
    derivePaymentAggregateStatus(TransferStatus.FAILED, TransferStatus.COMPLETED),
    PaymentStatus.UNDER_REVIEW,
  );
  assert.equal(
    derivePaymentAggregateStatus(TransferStatus.SUBMITTED, TransferStatus.COMPLETED),
    PaymentStatus.UNDER_REVIEW,
  );
  assert.equal(
    derivePaymentAggregateStatus(TransferStatus.COMPLETED, TransferStatus.CREATED),
    PaymentStatus.UNDER_REVIEW,
  );
});

test('two processing payout legs remain in settlement progress', () => {
  assert.equal(
    derivePaymentAggregateStatus(TransferStatus.PROCESSING, TransferStatus.PROCESSING),
    PaymentStatus.COMMISSION_TRANSFER_PENDING,
  );
});
