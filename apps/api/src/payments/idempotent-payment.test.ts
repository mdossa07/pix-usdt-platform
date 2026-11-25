import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPaymentCreationRequest, isValidIdempotencyKey } from './idempotent-payment.js';
import { hashMerchantPaymentRequest } from './merchant-payment-idempotency.js';

test('accepts sufficiently long printable idempotency keys', () => {
  assert.equal(isValidIdempotencyKey('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isValidIdempotencyKey('request:payment:001'), true);
});

test('rejects missing, short, oversized and unsafe idempotency keys', () => {
  assert.equal(isValidIdempotencyKey(undefined), false);
  assert.equal(isValidIdempotencyKey('short'), false);
  assert.equal(isValidIdempotencyKey('x'.repeat(129)), false);
  assert.equal(isValidIdempotencyKey('request key with spaces'), false);
});

test('hashes a canonical payment body independent of optional description whitespace', () => {
  const first = hashPaymentCreationRequest({
    walletDestinationId: 'wallet-1',
    amountBrlCents: 5000,
    description: '  Pedido  ',
  });
  const same = hashPaymentCreationRequest({
    walletDestinationId: 'wallet-1',
    amountBrlCents: 5000,
    description: 'Pedido',
  });
  const differentAmount = hashPaymentCreationRequest({
    walletDestinationId: 'wallet-1',
    amountBrlCents: 5001,
    description: 'Pedido',
  });
  assert.equal(first, same);
  assert.notEqual(first, differentAmount);
});

test('merchant payment request fingerprint normalizes text and keys personal data', () => {
  const input = {
    merchantId: 'merchant-1',
    externalId: 'external-123',
    amountBrlCents: 5000,
    walletDestinationId: 'wallet-1',
    payerName: '  Test Payer  ',
    payerTaxId: '12345678909',
    description: '  Checkout  ',
  };
  const key = 'a'.repeat(64);
  const normalized = { ...input, payerName: 'Test Payer', description: 'Checkout' };

  assert.equal(hashMerchantPaymentRequest(input, key), hashMerchantPaymentRequest(normalized, key));
  assert.notEqual(
    hashMerchantPaymentRequest(input, key),
    hashMerchantPaymentRequest({ ...input, payerTaxId: '98765432100' }, key),
  );
  assert.notEqual(
    hashMerchantPaymentRequest(input, key),
    hashMerchantPaymentRequest(input, 'b'.repeat(64)),
  );
});
