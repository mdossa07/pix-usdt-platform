import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWebhookSignature,
  isPublicIpAddress,
  parseWebhookEndpointUrl,
  resolvePublicWebhookTarget,
  verifyWebhookSignature,
} from './outbound-security.js';

test('accepts HTTPS DNS hostnames and rejects unsafe URL forms', () => {
  assert.equal(parseWebhookEndpointUrl('https://hooks.example.com/events').hostname, 'hooks.example.com');
  for (const url of [
    'http://hooks.example.com/events',
    'https://127.0.0.1/events',
    'https://[::1]/events',
    'https://localhost/events',
    'https://service.local/events',
    'https://service.internal/events',
    'https://hooks.example.com:8443/events',
    'https://user:pass@hooks.example.com/events',
    'https://hooks.example.com/events#fragment',
  ]) {
    assert.throws(() => parseWebhookEndpointUrl(url));
  }
});

test('classifies private, reserved and public IPv4/IPv6 addresses', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.0.0.4', '192.168.1.10', '198.18.0.1',
    '198.51.100.2', '203.0.113.4', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '64:ff9b::a00:1', '64:ff9b:1::1', '3fff::1',
  ]) assert.equal(isPublicIpAddress(address), false, address);

  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('1.1.1.1'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicIpAddress('2001:4860:4860::8888'), true);
});

test('fails closed when DNS returns any private address', async () => {
  await assert.rejects(
    resolvePublicWebhookTarget('https://hooks.example.com/events', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    /unsafe_webhook_host_address/,
  );
});

test('pins a public DNS answer and rejects DNS failures', async () => {
  const target = await resolvePublicWebhookTarget('https://hooks.example.com/events', async hostname => {
    assert.equal(hostname, 'hooks.example.com');
    return [{ address: '8.8.8.8', family: 4 }];
  });
  assert.equal(target.addresses.at(0)?.address, '8.8.8.8');
  await assert.rejects(resolvePublicWebhookTarget('https://hooks.example.com', async () => {
    throw new Error('dns error');
  }), /webhook_host_resolution_failed/);
});

test('signs the timestamp and exact raw body and compares signatures in constant time', () => {
  const timestamp = '1795563900';
  const body = '{"event":"payment.completed","amountBrlCents":"5000"}';
  const signature = buildWebhookSignature('a'.repeat(32), timestamp, body);
  assert.equal(signature.length, 64);
  assert.equal(verifyWebhookSignature('a'.repeat(32), timestamp, body, signature), true);
  assert.equal(verifyWebhookSignature('a'.repeat(32), timestamp, body + ' ', signature), false);
  assert.equal(verifyWebhookSignature('b'.repeat(32), timestamp, body, signature), false);
});
