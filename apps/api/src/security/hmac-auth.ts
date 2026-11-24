import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface MerchantAuthPayload {
  merchantId: string;
  keyId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    merchant?: MerchantAuthPayload;
  }
}

const SIGNATURE_HEADER = 'x-pixsplit-signature';
const TIMESTAMP_HEADER = 'x-pixsplit-timestamp';
const KEY_ID_HEADER = 'x-pixsplit-key-id';
const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Canonical signing string format:
 * METHOD\nPATH\nTIMESTAMP\nBODY
 * Body is the exact raw bytes received (no re-serialization).
 */
function buildSigningString(
  method: string,
  path: string,
  timestamp: string,
  body: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${body}`;
}

function safeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Derive the signing key from the stored hash and merchant ID.
 * This matches the derivation in generateMerchantApiKey and signRequest.
 */
function deriveSigningKey(keyHash: string, merchantId: string): Buffer {
  return createHmac('sha256', keyHash).update(merchantId).digest();
}

export async function hmacAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const keyId = request.headers[KEY_ID_HEADER];
  const signature = request.headers[SIGNATURE_HEADER];
  const timestamp = request.headers[TIMESTAMP_HEADER];

  if (!keyId || !signature || !timestamp) {
    void reply.code(401).send({ error: 'Missing authentication headers' });
    return;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    void reply.code(401).send({ error: 'Invalid timestamp format' });
    return;
  }

  const now = Date.now();
  if (Math.abs(now - ts) > MAX_SKEW_MS) {
    void reply.code(401).send({ error: 'Request timestamp expired' });
    return;
  }

  // Lookup by full keyId (UUID), not prefix. Prefix is only for display/identification.
  const apiKey = await prisma.merchantApiKey.findFirst({
    where: {
      id: String(keyId),
      revokedAt: null,
      merchant: { isEnabled: true },
    },
    include: { merchant: true },
  });

  if (!apiKey) {
    void reply.code(401).send({ error: 'Invalid or revoked API key' });
    return;
  }

  // Use rawBody buffer directly — never re-serialize JSON
  const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  const rawBody = raw ? raw.toString('utf8') : '';
  const path = request.url.split('?')[0] || '/';
  const signingString = buildSigningString(request.method, path, String(timestamp), rawBody);

  // Derive signing key consistently: HMAC-SHA256(keyHash, merchantId)
  const derivedKey = deriveSigningKey(apiKey.keyHash, apiKey.merchantId);

  const expectedSig = createHmac('sha256', derivedKey)
    .update(signingString)
    .digest('hex');

  const sigBuffer = Buffer.from(String(signature), 'hex');
  const expectedBuffer = Buffer.from(expectedSig, 'hex');

  if (!safeCompare(sigBuffer, expectedBuffer)) {
    void reply.code(401).send({ error: 'Invalid signature' });
    return;
  }

  // Update lastUsedAt asynchronously (non-blocking)
  void prisma.merchantApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  request.merchant = {
    merchantId: apiKey.merchantId,
    keyId: apiKey.id,
  };
}

/**
 * Generate an API Key + Secret pair for a merchant.
 * The secret is returned ONLY in this call and never stored in plaintext.
 * Storage: SHA-256(secret) as keyHash. Signing key derived at validation time.
 */
export async function generateMerchantApiKey(
  merchantId: string,
  name: string,
): Promise<{ keyId: string; prefix: string; secret: string }> {
  const { randomBytes, createHash } = await import('node:crypto');

  const rawSecret = `psk_${randomBytes(32).toString('hex')}`;
  const prefix = rawSecret.slice(0, 12); // 12-char prefix for display only
  const keyHash = createHash('sha256').update(rawSecret).digest('hex');

  const record = await prisma.merchantApiKey.create({
    data: {
      merchantId,
      name,
      prefix,
      keyHash,
    },
  });

  return {
    keyId: record.id,
    prefix,
    secret: rawSecret,
  };
}

/**
 * Sign a request for testing/integration purposes.
 * Uses the SAME derivation as the middleware: HMAC-SHA256(SHA256(secret), merchantId).
 */
export function signRequest(
  secret: string,
  merchantId: string,
  method: string,
  path: string,
  timestamp: number,
  rawBody: string,
): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const signingString = buildSigningString(method, path, String(timestamp), rawBody);
  // Derivation must match middleware: keyHash = SHA256(secret), then HMAC(keyHash, merchantId)
  const keyHash = createHash('sha256').update(secret).digest('hex');
  const derivedKey = createHmac('sha256', keyHash).update(merchantId).digest();
  return createHmac('sha256', derivedKey).update(signingString).digest('hex');
}