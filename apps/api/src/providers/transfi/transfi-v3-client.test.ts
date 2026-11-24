import assert from 'node:assert/strict';
import test from 'node:test';
import { TransFiApiError, TransFiV3Client } from './transfi-v3-client.js';

function createClient(fetchImpl: typeof fetch, timeoutMs = 5_000) {
  return new TransFiV3Client({
    baseUrl: 'https://sandbox.transfi.invalid',
    username: 'pixsplit-test-user',
    password: 'test-only-secret',
    mid: 'MID_TEST_123',
    timeoutMs,
    fetchImpl,
  });
}

test('requires HTTPS and complete provider credentials', () => {
  const fetchImpl = (async () => new Response('{}')) as typeof fetch;
  assert.throws(() => new TransFiV3Client({
    baseUrl: 'http://sandbox.transfi.invalid',
    username: 'user',
    password: 'password',
    mid: 'MID',
    fetchImpl,
  }), /transfi_base_url_must_use_https/);
  assert.throws(() => new TransFiV3Client({
    baseUrl: 'https://sandbox.transfi.invalid',
    username: '',
    password: 'password',
    mid: 'MID',
    fetchImpl,
  }), /transfi_username_required/);
});

test('discovers sender mandatory fields through the v3 POST contract', async () => {
  let call: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    call = { url: String(input), init: init ?? {} };
    return new Response(JSON.stringify({ fields: [{ name: 'dateOfBirth', required: true }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  const client = createClient(fetchImpl);

  const result = await client.getSenderMandatoryFields({ country: 'br', type: 'individual', currencyType: 'fiat' });
  assert.deepEqual(result, { fields: [{ name: 'dateOfBirth', required: true }] });
  assert.ok(call);
  assert.equal(call.url, 'https://sandbox.transfi.invalid/v3/senders/mandatory-fields');
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    country: 'BR',
    type: 'individual',
    currencyType: 'fiat',
  });
});

test('discovers recipient mandatory fields with country, type and currencyType query', async () => {
  let call: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    call = { url: String(input), init: init ?? {} };
    return new Response(JSON.stringify({ fields: [] }), { status: 200 });
  }) as typeof fetch;
  const client = createClient(fetchImpl);

  await client.getRecipientMandatoryFields({ country: 'BR', type: 'individual', currencyType: 'crypto' });
  assert.ok(call);
  const url = new URL(call.url);
  assert.equal(url.pathname, '/v3/recipients/mandatory-fields');
  assert.equal(url.searchParams.get('country'), 'BR');
  assert.equal(url.searchParams.get('type'), 'individual');
  assert.equal(url.searchParams.get('currencyType'), 'crypto');
  assert.equal(call.init.method, 'GET');
});

test('lists BR deposit payment methods and uppercases country code', async () => {
  let calledUrl = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calledUrl = String(input);
    return new Response(JSON.stringify([{ paymentType: 'bank_transfer', paymentCode: 'PIX' }]), { status: 200 });
  }) as typeof fetch;
  const client = createClient(fetchImpl);

  const result = await client.listPaymentMethods({ direction: 'deposit', country: 'br' });
  assert.deepEqual(result, [{ paymentType: 'bank_transfer', paymentCode: 'PIX' }]);
  const url = new URL(calledUrl);
  assert.equal(url.pathname, '/v3/config/payment-methods');
  assert.equal(url.searchParams.get('direction'), 'deposit');
  assert.equal(url.searchParams.get('country'), 'BR');
});

test('sends orders with provider partnerId and authenticated MID', async () => {
  let call: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    call = { url: String(input), init: init ?? {} };
    return new Response(JSON.stringify({ orderId: 'ORDER-001', status: 'created' }), { status: 201 });
  }) as typeof fetch;
  const client = createClient(fetchImpl);
  const order = {
    userId: 'sender_001',
    orderType: 'payin' as const,
    purposeCode: 'invoice_payment',
    partnerId: 'pixsplit_payment_001',
    source: { currency: 'BRL', amount: '100.00', paymentType: 'bank_transfer', paymentCode: 'PIX' },
    destination: { currency: 'USDT' },
  };

  const result = await client.createOrder(order);
  assert.deepEqual(result, { orderId: 'ORDER-001', status: 'created' });
  assert.ok(call);
  assert.equal(call.url, 'https://sandbox.transfi.invalid/v3/orders');
  assert.equal(call.init.method, 'POST');
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get('mid'), 'MID_TEST_123');
  assert.equal(headers.get('authorization'), `Basic ${Buffer.from('pixsplit-test-user:test-only-secret').toString('base64')}`);
  assert.deepEqual(JSON.parse(String(call.init.body)), order);
});

test('rejects an order without a safe stable partnerId before making a request', async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;
  const client = createClient(fetchImpl);

  await assert.rejects(() => client.createOrder({
    userId: 'sender_001',
    orderType: 'payin',
    purposeCode: 'invoice_payment',
    partnerId: 'contains spaces',
    source: { currency: 'BRL' },
    destination: { currency: 'USDT' },
  }), /transfi_partner_id_invalid/);
  assert.equal(called, false);
});

test('retrieves order status and available balance through v3 endpoints', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ status: 'fund_settled', available: '25.00' }), { status: 200 });
  }) as typeof fetch;
  const client = createClient(fetchImpl);

  await client.getOrder('ORDER/001');
  await client.getBalance();
  assert.equal(calls[0], 'https://sandbox.transfi.invalid/v3/orders/ORDER%2F001');
  assert.equal(calls[1], 'https://sandbox.transfi.invalid/v3/balance');
});

test('does not leak provider error payloads and preserves safe error codes', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    errorCode: 'invalid_payment_method',
    message: 'payer CPF 12345678901 is invalid',
  }), { status: 400 })) as typeof fetch;
  const client = createClient(fetchImpl);

  await assert.rejects(
    () => client.listPaymentMethods({ direction: 'deposit', country: 'BR' }),
    (error: unknown) => {
      assert.ok(error instanceof TransFiApiError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.providerCode, 'invalid_payment_method');
      assert.equal(error.outcomeUnknown, false);
      assert.equal(error.message.includes('12345678901'), false);
      return true;
    },
  );
});

test('marks network failures from order POSTs as unknown outcomes and never retries automatically', async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    throw Object.assign(new Error('socket closed'), { name: 'AbortError' });
  }) as typeof fetch;
  const client = createClient(fetchImpl);

  await assert.rejects(
    () => client.createOrder({
      userId: 'sender_001',
      orderType: 'payin',
      purposeCode: 'invoice_payment',
      partnerId: 'pixsplit_payment_002',
      source: { currency: 'BRL' },
      destination: { currency: 'USDT' },
    }),
    (error: unknown) => {
      assert.ok(error instanceof TransFiApiError);
      assert.equal(error.statusCode, null);
      assert.equal(error.providerCode, 'request_timeout');
      assert.equal(error.outcomeUnknown, true);
      return true;
    },
  );
  assert.equal(attempts, 1);
});
