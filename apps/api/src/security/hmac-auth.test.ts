import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rawBody from 'fastify-raw-body';
import { PrismaClient } from '@prisma/client';
import { createHmacAuthMiddleware, generateMerchantApiKey, signRequest } from './hmac-auth.js';

const prisma = new PrismaClient();

describe('HMAC Authentication', () => {
  let app: FastifyInstance;
  let merchantId: string;
  let userId: string;
  let keyId: string;
  let secret: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `hmac-test-${Date.now()}@pixsplit.dev`,
        passwordHash: 'dummy-hash-not-used',
        fullName: 'HMAC Test User',
        role: 'MERCHANT',
      },
    });
    userId = user.id;
    const merchant = await prisma.merchant.create({
      data: {
        userId: user.id,
        legalName: 'Test Merchant HMAC',
        taxIdEncrypted: 'test-tax-id-hmac',
        taxIdLast4: '1234',
        merchantType: 'COMPANY',
        isEnabled: true,
        kycStatus: 'APPROVED',
      },
    });
    merchantId = merchant.id;

    const result = await generateMerchantApiKey(merchantId, 'Test Key', prisma);
    keyId = result.keyId;
    secret = result.secret;

    app = Fastify();
    await app.register(rawBody, { field: 'rawBody', global: false, encoding: false, runFirst: true });
    app.addHook('preHandler', createHmacAuthMiddleware(prisma));
    app.post('/test', { config: { rawBody: true } }, async (request) => ({ ok: true, merchantId: request.merchant?.merchantId }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.merchantApiKey.deleteMany({ where: { merchantId } });
    await prisma.merchant.delete({ where: { id: merchantId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function sendSignedRequest(signature: string, timestamp = Date.now(), body = JSON.stringify({ amount: 100 })) {
    return app.inject({
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
  }

  it('A. Authenticates a valid request using the original API secret', async () => {
    const timestamp = Date.now();
    const body = JSON.stringify({ amount: 100 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);
    const response = await sendSignedRequest(signature, timestamp, body);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, merchantId });
  });

  it('B. Stores only a hash verifier and an encrypted signing secret', async () => {
    const record = await prisma.merchantApiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(record.keyHash).not.toBe(secret);
    expect(record.signingSecretEncrypted).toBeTruthy();
    expect(record.signingSecretEncrypted).not.toBe(secret);
    expect(record.signingSecretEncrypted).not.toBe(record.keyHash);
  });

  it('C. A database-only keyHash disclosure cannot forge a request signature', async () => {
    const record = await prisma.merchantApiKey.findUniqueOrThrow({ where: { id: keyId } });
    const timestamp = Date.now();
    const body = JSON.stringify({ amount: 100 });
    const signingString = `POST\n/test\n${timestamp}\n${body}`;
    // Simulate the old vulnerable derivation using only the database keyHash.
    const derivedKey = createHmac('sha256', record.keyHash).update(merchantId).digest();
    const forgedSignature = createHmac('sha256', derivedKey).update(signingString).digest('hex');
    const response = await sendSignedRequest(forgedSignature, timestamp, body);

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid signature');
  });

  it('D. Rejects a legacy key without an encrypted signing secret and requests rotation', async () => {
    const record = await prisma.merchantApiKey.findUniqueOrThrow({ where: { id: keyId } });
    await prisma.merchantApiKey.update({ where: { id: keyId }, data: { signingSecretEncrypted: null } });
    try {
      const timestamp = Date.now();
      const body = JSON.stringify({ amount: 100 });
      const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);
      const response = await sendSignedRequest(signature, timestamp, body);
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('api_key_rotation_required');
    } finally {
      await prisma.merchantApiKey.update({
        where: { id: keyId },
        data: { signingSecretEncrypted: record.signingSecretEncrypted },
      });
    }
  });

  it('E. Rejects a tampered signature', async () => {
    const timestamp = Date.now();
    const body = JSON.stringify({ amount: 100 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);
    const tamperedSig = signature.slice(0, -4) + '0000';
    const response = await sendSignedRequest(tamperedSig, timestamp, body);

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid signature');
  });

  it('F. Rejects a revoked key', async () => {
    await prisma.merchantApiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    try {
      const timestamp = Date.now();
      const body = JSON.stringify({ amount: 100 });
      const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);
      const response = await sendSignedRequest(signature, timestamp, body);
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toContain('revoked');
    } finally {
      await prisma.merchantApiKey.update({ where: { id: keyId }, data: { revokedAt: null } });
    }
  });

  it('G. Rejects timestamps older than the five-minute window', async () => {
    const timestamp = Date.now() - 6 * 60 * 1000;
    const body = JSON.stringify({ amount: 100 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, body);
    const response = await sendSignedRequest(signature, timestamp, body);

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('expired');
  });

  it('H. Rejects missing headers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('Missing');
  });

  it('I. Validates raw body integrity', async () => {
    const timestamp = Date.now();
    const originalBody = JSON.stringify({ amount: 100 });
    const differentBody = JSON.stringify({ amount: 200 });
    const signature = signRequest(secret, merchantId, 'POST', '/test', timestamp, originalBody);
    const response = await sendSignedRequest(signature, timestamp, differentBody);

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid signature');
  });
});
