import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { hmacAuthMiddleware, generateMerchantApiKey, signRequest } from './hmac-auth.js';

const prisma = new PrismaClient();

describe('HMAC Authentication', () => {
  let app: FastifyInstance;
  let merchantId: string;
  let keyId: string;
  let secret: string;

  beforeAll(async () => {
    // Create user + merchant for HMAC tests
    const user = await prisma.user.create({
      data: {
        email: `hmac-test-${Date.now()}@pixsplit.dev`,
        passwordHash: 'dummy-hash-not-used',
        fullName: 'HMAC Test User',
        role: 'MERCHANT',
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: user.id,
        legalName: 'Test Merchant HMAC',
        taxIdEncrypted: 'test-tax-id-hmac',
        taxIdLast4: '1234',
        merchantType: 'COMPANY',
        isEnabled: true,
      },
    });
    merchantId = merchant.id;

    // Generate API key
    const result = await generateMerchantApiKey(merchantId, 'Test Key');
    keyId = result.keyId;
    secret = result.secret;

    // Setup Fastify app with HMAC middleware
    app = Fastify();
    app.addHook('preHandler', hmacAuthMiddleware);
    app.post('/test', async (request) => {
      return { ok: true, merchantId: request.merchant?.merchantId };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    // Cleanup
    await prisma.merchantApiKey.deleteMany({ where: { merchantId } });
    await prisma.merchant.delete({ where: { id: merchantId } });
    await prisma.$disconnect();
  });

  it('A. Authenticates valid request with newly created key', async () => {
    const timestamp = Date.now();
    const body = JSON.stringify({ amount: 100 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-pixsplit-key-id': keyId,
        'x-pixsplit-timestamp': String(timestamp),
        'x-pixsplit-signature': signature,
        'content-type': 'application/json',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, merchantId });
  });

  it('B. Rejects tampered signature', async () => {
    const timestamp = Date.now();
    const body = JSON.stringify({ amount: 100 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);
    const tamperedSig = signature.slice(0, -4) + '0000';

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-pixsplit-key-id': keyId,
        'x-pixsplit-timestamp': String(timestamp),
        'x-pixsplit-signature': tamperedSig,
        'content-type': 'application/json',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('Invalid signature');
  });

  it('C. Rejects revoked key', async () => {
    // Revoke the key
    await prisma.merchantApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    const timestamp = Date.now();
    const body = JSON.stringify({ amount: 100 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-pixsplit-key-id': keyId,
        'x-pixsplit-timestamp': String(timestamp),
        'x-pixsplit-signature': signature,
        'content-type': 'application/json',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('revoked');

    // Restore key for other tests
    await prisma.merchantApiKey.update({
      where: { id: keyId },
      data: { revokedAt: null },
    });
  });

  it('D. Rejects expired timestamp (>5min skew)', async () => {
    const timestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    const body = JSON.stringify({ amount: 100 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-pixsplit-key-id': keyId,
        'x-pixsplit-timestamp': String(timestamp),
        'x-pixsplit-signature': signature,
        'content-type': 'application/json',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('expired');
  });

  it('E. Rejects missing headers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('Missing');
  });

  it('F. Validates raw body integrity (different body fails)', async () => {
    const timestamp = Date.now();
    const originalBody = JSON.stringify({ amount: 100 });
    const differentBody = JSON.stringify({ amount: 200 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, originalBody);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-pixsplit-key-id': keyId,
        'x-pixsplit-timestamp': String(timestamp),
        'x-pixsplit-signature': signature,
        'content-type': 'application/json',
      },
      payload: differentBody, // Body differs from signed one
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('Invalid signature');
  });
});