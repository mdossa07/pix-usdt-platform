import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rawBody from 'fastify-raw-body';
import { PrismaClient } from '@prisma/client';
import { createHmacAuthMiddleware, createRequestNonce, generateMerchantApiKey, signRequest } from './hmac-auth.js';

const adminPrisma = new PrismaClient();
let prisma: PrismaClient;

describe('HMAC Authentication', () => {
  let app: FastifyInstance;
  let merchantId: string;
  let userId: string;
  let keyId: string;
  let secret: string;

  beforeAll(async () => {
    await adminPrisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS "hmac_test"');
    const databaseUrl = new URL(process.env.DATABASE_URL!);
    databaseUrl.searchParams.set('schema', 'hmac_test');
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });

    const user = await prisma.user.create({ data: {
      email: `hmac-test-${Date.now()}@pixsplit.dev`, passwordHash: 'dummy-hash-not-used',
      fullName: 'HMAC Test User', role: 'MERCHANT',
    } });
    userId = user.id;
    const merchant = await prisma.merchant.create({ data: {
      userId: user.id, legalName: 'Test Merchant HMAC', taxIdEncrypted: 'test-tax-id-hmac',
      taxIdLast4: '1234', merchantType: 'COMPANY', isEnabled: true, kycStatus: 'APPROVED',
    } });
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
    if (app) await app.close();
    if (prisma) {
      await prisma.merchantApiKey.deleteMany({ where: { merchantId } });
      await prisma.merchant.deleteMany({ where: { id: merchantId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
    await adminPrisma.$disconnect();
  });

  async function sendSignedRequest(signature: string, timestamp = Date.now(), body = JSON.stringify({ amount: 100 }), nonce = createRequestNonce()) {
    return app.inject({
      method: 'POST', url: '/test',
      headers: {
        'x-pixsplit-key-id': keyId, 'x-pixsplit-timestamp': String(timestamp),
        'x-pixsplit-signature': signature, 'x-pixsplit-nonce': nonce,
        'content-type': 'application/json',
      },
      payload: body,
    });
  }

  function signature(timestamp: number, body: string, nonce: string) {
    return signRequest(secret, merchantId, 'POST', '/test', timestamp, body, nonce);
  }

  it('authenticates a valid request and consumes its nonce', async () => {
    const timestamp = Date.now(), body = JSON.stringify({ amount: 100 }), nonce = createRequestNonce();
    const response = await sendSignedRequest(signature(timestamp, body, nonce), timestamp, body, nonce);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, merchantId });
  });

  it('rejects replay of an already accepted signed request', async () => {
    const timestamp = Date.now(), body = JSON.stringify({ amount: 100 }), nonce = createRequestNonce();
    const sig = signature(timestamp, body, nonce);
    const first = await sendSignedRequest(sig, timestamp, body, nonce);
    const replay = await sendSignedRequest(sig, timestamp, body, nonce);
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toBe('request_replayed');
  });

  it('stores only a hash verifier and an encrypted signing secret', async () => {
    const record = await prisma.merchantApiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(record.keyHash).not.toBe(secret);
    expect(record.signingSecretEncrypted).toBeTruthy();
    expect(record.signingSecretEncrypted).not.toBe(secret);
    expect(record.signingSecretEncrypted).not.toBe(record.keyHash);
  });

  it('does not allow a database-only keyHash disclosure to forge a signature', async () => {
    const record = await prisma.merchantApiKey.findUniqueOrThrow({ where: { id: keyId } });
    const timestamp = Date.now(), body = JSON.stringify({ amount: 100 }), nonce = createRequestNonce();
    const signingString = `POST\n/test\n${timestamp}\n${nonce}\n${body}`;
    const derivedKey = createHmac('sha256', record.keyHash).update(merchantId).digest();
    const forged = createHmac('sha256', derivedKey).update(signingString).digest('hex');
    const response = await sendSignedRequest(forged, timestamp, body, nonce);
    expect(response.statusCode).toBe(401);
  });

  it('rejects legacy keys without encrypted signing secrets', async () => {
    const record = await prisma.merchantApiKey.findUniqueOrThrow({ where: { id: keyId } });
    await prisma.merchantApiKey.update({ where: { id: keyId }, data: { signingSecretEncrypted: null } });
    try {
      const timestamp = Date.now(), body = '{}', nonce = createRequestNonce();
      const response = await sendSignedRequest(signature(timestamp, body, nonce), timestamp, body, nonce);
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('api_key_rotation_required');
    } finally {
      await prisma.merchantApiKey.update({ where: { id: keyId }, data: { signingSecretEncrypted: record.signingSecretEncrypted } });
    }
  });

  it('rejects tampered signatures and bodies', async () => {
    const timestamp = Date.now(), body = JSON.stringify({ amount: 100 }), nonce = createRequestNonce();
    const sig = signature(timestamp, body, nonce);
    const tampered = await sendSignedRequest(`${sig.slice(0, -2)}00`, timestamp, body, nonce);
    expect(tampered.statusCode).toBe(401);
    const differentBody = await sendSignedRequest(sig, timestamp, JSON.stringify({ amount: 200 }), nonce);
    expect(differentBody.statusCode).toBe(401);
  });

  it('rejects revoked keys and stale timestamps', async () => {
    await prisma.merchantApiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    try {
      const timestamp = Date.now(), body = '{}', nonce = createRequestNonce();
      const response = await sendSignedRequest(signature(timestamp, body, nonce), timestamp, body, nonce);
      expect(response.statusCode).toBe(401);
    } finally {
      await prisma.merchantApiKey.update({ where: { id: keyId }, data: { revokedAt: null } });
    }
    const timestamp = Date.now() - 6 * 60 * 1000, body = '{}', nonce = createRequestNonce();
    const stale = await sendSignedRequest(signature(timestamp, body, nonce), timestamp, body, nonce);
    expect(stale.statusCode).toBe(401);
  });

  it('requires all authentication headers and a well-formed nonce', async () => {
    const missing = await app.inject({ method: 'POST', url: '/test', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(missing.statusCode).toBe(401);
    const badNonce = await sendSignedRequest('0'.repeat(64), Date.now(), '{}', 'short');
    expect(badNonce.statusCode).toBe(401);
  });
});
