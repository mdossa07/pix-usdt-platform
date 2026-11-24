import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { decryptPii, encryptPii } from './crypto.js';

const defaultPrisma = new PrismaClient();

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
const NONCE_HEADER = 'x-pixsplit-nonce';
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
  nonce: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${body}`;
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
 * Create an injectable middleware so tests and isolated applications can share
 * their Prisma client instead of opening hidden database pools.
 */
export function createHmacAuthMiddleware(db: PrismaClient) {
  return async function hmacAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const keyId = request.headers[KEY_ID_HEADER];
    const signature = request.headers[SIGNATURE_HEADER];
    const timestamp = request.headers[TIMESTAMP_HEADER];
    const nonce = request.headers[NONCE_HEADER];

    if (
      typeof keyId !== 'string'
      || typeof signature !== 'string'
      || typeof timestamp !== 'string'
      || typeof nonce !== 'string'
    ) {
      void reply.code(401).send({ error: 'Missing authentication headers' });
      return;
    }

    if (!/^[a-f0-9]{32,128}$/i.test(nonce)) {
      void reply.code(401).send({ error: 'Invalid nonce' });
      return;
    }

    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      void reply.code(401).send({ error: 'Invalid signature' });
      return;
    }

    const ts = Number(timestamp);
    if (!Number.isSafeInteger(ts)) {
      void reply.code(401).send({ error: 'Invalid timestamp format' });
      return;
    }

    const now = Date.now();
    if (Math.abs(now - ts) > MAX_SKEW_MS) {
      void reply.code(401).send({ error: 'Request timestamp expired' });
      return;
    }

    // Lookup by full keyId (UUID), not prefix. Prefix is only for display/identification.
    const apiKey = await db.merchantApiKey.findFirst({
      where: {
        id: keyId,
        revokedAt: null,
        merchant: { isEnabled: true },
      },
      include: { merchant: true },
    });

    if (!apiKey) {
      void reply.code(401).send({ error: 'Invalid or revoked API key' });
      return;
    }

    if (apiKey.merchant.kycStatus !== 'APPROVED') {
      void reply.code(403).send({ error: 'merchant_kyc_not_approved' });
      return;
    }

    // Legacy rows have only a SHA-256 verifier. That verifier is not a signing
    // secret, so reject them and require rotation instead of weakening auth.
    if (!apiKey.signingSecretEncrypted) {
      void reply.code(401).send({ error: 'api_key_rotation_required' });
      return;
    }

    let signingSecret: string;
    try {
      signingSecret = decryptPii(apiKey.signingSecretEncrypted);
    } catch {
      void reply.code(401).send({ error: 'api_key_rotation_required' });
      return;
    }

    // Detect a corrupt or mismatched encrypted value before verifying requests.
    const calculatedHash = createHash('sha256').update(signingSecret).digest();
    const storedHash = Buffer.from(apiKey.keyHash, 'hex');
    if (!safeCompare(calculatedHash, storedHash)) {
      void reply.code(401).send({ error: 'api_key_rotation_required' });
      return;
    }

    // Sign with the original random secret, never with its database verifier.
    const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const rawBody = raw ? raw.toString('utf8') : '';
    const path = request.url.split('?')[0] || '/';
    const signingString = buildSigningString(request.method, path, timestamp, rawBody, nonce);
    const expectedSig = createHmac('sha256', signingSecret).update(signingString).digest();
    const receivedSig = Buffer.from(signature, 'hex');

    if (!safeCompare(receivedSig, expectedSig)) {
      void reply.code(401).send({ error: 'Invalid signature' });
      return;
    }

    // Atomically consume each signed nonce. A unique database constraint makes
    // concurrent replays fail even when they reach different API instances.
    const nonceScope = `merchant-hmac:${apiKey.id}`;
    try {
      await db.idempotencyRecord.deleteMany({
        where: { scope: nonceScope, expiresAt: { lt: new Date(now) } },
      });
      await db.idempotencyRecord.create({
        data: {
          scope: nonceScope,
          key: nonce.toLowerCase(),
          requestHash: createHash('sha256').update(signingString).digest('hex'),
          expiresAt: new Date(now + MAX_SKEW_MS * 2),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        void reply.code(409).send({ error: 'request_replayed' });
        return;
      }
      throw error;
    }

    // Update lastUsedAt asynchronously (non-blocking).
    void db.merchantApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    request.merchant = {
      merchantId: apiKey.merchantId,
      keyId: apiKey.id,
    };
  };
}

export const hmacAuthMiddleware = createHmacAuthMiddleware(defaultPrisma);

/**
 * Generate an API Key + Secret pair for a merchant.
 * The raw secret is returned ONLY in this call. At rest, the database stores:
 * - SHA-256(secret), used as a consistency verifier;
 * - AES-256-GCM encrypted secret, required by the server to validate HMAC.
 * A database-only disclosure therefore does not expose the HMAC signing secret.
 */
export async function generateMerchantApiKey(
  merchantId: string,
  name: string,
  db: PrismaClient = defaultPrisma,
): Promise<{ keyId: string; prefix: string; secret: string }> {
  const rawSecret = `psk_${(await import('node:crypto')).randomBytes(32).toString('hex')}`;
  const prefix = rawSecret.slice(0, 12);
  const keyHash = createHash('sha256').update(rawSecret).digest('hex');

  const record = await db.merchantApiKey.create({
    data: {
      merchantId,
      name,
      prefix,
      keyHash,
      signingSecretEncrypted: encryptPii(rawSecret),
    },
  });

  return {
    keyId: record.id,
    prefix,
    secret: rawSecret,
  };
}

/**
 * HMAC-SHA256(secret, METHOD\nPATH\nTIMESTAMP\nNONCE\nRAW_BODY), lower-case hex.
 * merchantId remains in the helper signature for backwards-compatible SDK calls;
 * the key ID selects the merchant-scoped secret on the server.
 */
export function signRequest(
  secret: string,
  _merchantId: string,
  method: string,
  path: string,
  timestamp: number,
  rawBody: string,
  nonce: string,
): string {
  const signingString = buildSigningString(method, path, String(timestamp), rawBody, nonce);
  return createHmac('sha256', secret).update(signingString).digest('hex');
}

export function createRequestNonce(): string {
  return randomBytes(24).toString('hex');
}
