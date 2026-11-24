import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TransFiClient,
  TransFiClientError,
  type TransFiClientOptions,
} from './transfi-client.js';

function createClient(
  respond: (url: string, init?: RequestInit) => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ status: 'success', data: { orderId: 'OR-123456' }, traceId: 'trace-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'request-1' },
    }),
  overrides: Partial<TransFiClientOptions> = {},
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    return respond(url, init);
  };
  const client = new TransFiClient({
    baseUrl: 'https://sandbox-api.transfi.com',
    username: 'sandbox-user',
    password: 'sandbox-password',
    mid: 'MID-SANDBOX-001',
    fetchImpl,
    ...overrides,
  });
  return { client, calls };
}

test('sends Basic auth and MID on all requests without a generic idempotency header', async () => {
  const { client, calls } = createClient();
  const result = await client.request({ method: 'GET', path: '/v3/balance' });

  assert.equal(result.status, 200);
  assert.equal(result.requestId, 'request-1');
  const call = calls[0];
  assert.ok(call);
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get('authorization'), `Basic ${Buffer.from('sandbox-user:sandbox-password').toString('base64')}`);
  assert.equal(headers.get('mid'), 'MID-SANDBOX-001');
  assert.equal(headers.get('idempotency-key'), null);
  assert.equal(call.init?.method, 'GET');
});

test('requires credentials and MID before sending a request', async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    networkCalls += 1;
    return new Response('{}', { status: 200 });
  };

  const noCredentials = new TransFiClient({
    baseUrl: 'https://sandbox-api.transfi.com',
    username: '',
    password: '',
    mid: 'MID-SANDBOX-001',
    fetchImpl,
  });
  await assert.rejects(
    noCredentials.request({ method: 'GET', path: '/v3/balance' }),
    /transfi_credentials_not_configured/,
  );

  const noMid = new TransFiClient({
    baseUrl: 'https://sandbox-api.transfi.com',
    username: 'user',
    password: 'password',
    mid: '',
    fetchImpl,
  });
  await assert.rejects(noMid.request({ method: 'GET', path: '/v3/balance' }), /transfi_mid_required/);
  assert.equal(networkCalls, 0);
});

test('uses v3 dynamic sender and recipient field endpoints with the documented request bodies', async () => {
  const { client, calls } = createClient();

  await client.getSenderMandatoryFields({ type: 'individual', geo: 'BR', currencyType: 'fiat' });
  await client.getRecipientMandatoryFields({ type: 'organization', geo: 'BR', currencyType: 'crypto' });

  assert.equal(calls[0]?.url, 'https://sandbox-api.transfi.com/v3/senders/mandatory-fields');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    type: 'individual',
    geo: 'BR',
    currencyType: 'fiat',
  });
  assert.equal(calls[1]?.url, 'https://sandbox-api.transfi.com/v3/recipients/mandatory-fields');
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    type: 'organization',
    geo: 'BR',
    currencyType: 'crypto',
  });
});

test('creates sender and recipient profiles on separate v3 endpoints', async () => {
  const { client, calls } = createClient();

  await client.createIndividualSender({ country: 'BR', currencyType: 'fiat', firstName: 'Ana' });
  await client.createBusinessSender({ country: 'BR', currencyType: 'fiat', businessName: 'Loja Exemplo Ltda' });
  await client.createIndividualRecipient({ country: 'BR', currencyType: 'crypto', firstName: 'Joao', accountIdentifier: { type: 'wallet', value: 'masked' } });
  await client.createBusinessRecipient({ country: 'BR', currencyType: 'crypto', businessName: 'Beneficiaria Ltda', accountIdentifier: { type: 'wallet', value: 'masked' } });

  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/v3/senders/individual',
    '/v3/senders/business',
    '/v3/recipients/individual',
    '/v3/recipients/business',
  ]);
});

test('discovers payment methods through v3 config before payin or payout', async () => {
  const { client, calls } = createClient();
  await client.listPaymentMethods({
    direction: 'deposit',
    country: 'BR',
    currency: 'BRL',
    headlessMode: true,
    userType: 'individual',
    limit: 50,
    page: 2,
  });

  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, '/v3/config/payment-methods');
  assert.equal(url.searchParams.get('direction'), 'deposit');
  assert.equal(url.searchParams.get('country'), 'BR');
  assert.equal(url.searchParams.get('currency'), 'BRL');
  assert.equal(url.searchParams.get('headlessMode'), 'true');
  assert.equal(url.searchParams.get('userType'), 'individual');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.equal(url.searchParams.get('page'), '2');
});

test('creates v3 orders with partnerId in the body and rejects ambiguous amount placement', async () => {
  const { client, calls } = createClient();
  const order = {
    partnerId: 'pixsplit-payment-001',
    userId: 'UX-123456789',
    orderType: 'payin' as const,
    purposeCode: 'company_expenses',
    source: { currency: 'BRL', amount: '100.00', paymentType: 'local_wallet', paymentCode: 'PIX' },
    destination: { currency: 'USDT' },
  };
  await client.createOrder(order);

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(calls[0]?.url, 'https://sandbox-api.transfi.com/v3/orders');
  assert.equal(body.partnerId, 'pixsplit-payment-001');
  assert.equal(body.orderType, 'payin');
  assert.equal(body.source.amount, '100.00');
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get('idempotency-key'), null);

  assert.throws(
    () => client.createOrder({
      ...order,
      source: { currency: 'BRL', amount: '100.00' },
      destination: { currency: 'USDT', amount: '98.00' },
    }),
    /transfi_exactly_one_order_amount_required/,
  );
});

test('requires partnerId, purposeCode and userId on customer payin/payout orders', async () => {
  const { client } = createClient();
  const base = {
    partnerId: 'pixsplit-order-001',
    userId: 'UX-123456789',
    orderType: 'payout' as const,
    purposeCode: 'invoice_payment',
    source: { currency: 'USDT' },
    destination: { currency: 'USDT', amount: '10', network: 'polygon' },
  };

  assert.throws(() => client.createOrder({ ...base, partnerId: '' }), /invalid_transfi_partner_id/);
  assert.throws(() => client.createOrder({ ...base, purposeCode: '' }), /transfi_purpose_code_required/);
  assert.throws(() => client.createOrder({ ...base, userId: undefined }), /transfi_user_id_required/);
  assert.throws(() => client.createOrder({ ...base, purposeCode: 'other' }), /transfi_purpose_code_reason_required/);
});

test('gets order, lists orders and checks available balance via v3 endpoints', async () => {
  const { client, calls } = createClient();
  await client.getOrder('OR-2509291454262384294');
  await client.getOrder('PF-2509291454262384294');
  await client.listOrders({ page: 2, limit: 50, orderType: 'payout', status: 'asset_settled', userId: 'UX-123456789' });
  await client.getBalance({ currency: 'USDT', page: 1, limit: 5 });

  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/v3/orders/OR-2509291454262384294',
    '/v3/orders/PF-2509291454262384294',
    '/v3/orders',
    '/v3/balance',
  ]);
  assert.equal(new URL(calls[2]!.url).searchParams.get('status'), 'asset_settled');
  assert.equal(new URL(calls[3]!.url).searchParams.get('currency'), 'USDT');
  assert.throws(() => client.getOrder('not-an-order'), /invalid_transfi_order_id/);
});

test('starts hosted KYC and KYB and checks role-level verification status', async () => {
  const { client, calls } = createClient();
  await client.startStandardKyc('UX-123456789');
  await client.startStandardKyb('UX-123456789');
  await client.getKycAccountStatus('UX-123456789', 'sender');
  await client.getKybAccountStatus('UX-123456789', 'recipient');

  assert.equal(new URL(calls[0]!.url).pathname, '/v3/kyc/standard');
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { userId: 'UX-123456789' });
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { userId: 'UX-123456789', uiEnabled: true });
  assert.equal(new URL(calls[2]!.url).searchParams.get('accountType'), 'sender');
  assert.equal(new URL(calls[3]!.url).searchParams.get('accountType'), 'recipient');
});

test('rejects non-TransFi hosts and non-v3 paths', async () => {
  assert.throws(() => new TransFiClient({
    baseUrl: 'https://attacker.example',
    username: 'user',
    password: 'pass',
    mid: 'MID',
  }), /invalid_transfi_base_url/);

  const { client } = createClient();
  await assert.rejects(
    client.request({ method: 'GET', path: 'https://attacker.example/steal' }),
    /transfi_v3_path_required/,
  );
});

test('surfaces provider status and trace information without retrying mutations', async () => {
  const { client, calls } = createClient(() => new Response(
    JSON.stringify({ status: 'error', traceId: 'trace-failed', error: { code: 'VALIDATION_ERROR' } }),
    { status: 400, statusText: 'Bad Request', headers: { 'content-type': 'application/json' } },
  ));

  await assert.rejects(
    client.createOrder({
      partnerId: 'pixsplit-failed-1',
      userId: 'UX-123456789',
      orderType: 'payin',
      purposeCode: 'company_expenses',
      source: { currency: 'BRL', amount: '100' },
      destination: { currency: 'USDT' },
    }),
    (error: unknown) => error instanceof TransFiClientError
      && error.status === 400
      && error.requestId === 'trace-failed'
      && calls.length === 1,
  );
});
