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

  const apiKey = await prisma.merchantApiKey.findFirst({
    where: {
      prefix: String(keyId).slice(0, 8),
      revokedAt: null,
      merchant: { isEnabled: true },
    },
    include: { merchant: true },
  });

  if (!apiKey) {
    void reply.code(401).send({ error: 'Invalid or revoked API key' });
    return;
  }

  // Em produção, usaríamos argon2/bcrypt para verificar o hash da chave secreta.
  // Para esta fase, validamos a assinatura HMAC usando o keyHash como segredo derivado.
  // O fluxo real seria: merchant envia secret -> server deriva signing key -> valida HMAC.
  // Aqui simplificamos: o keyHash armazena HMAC-SHA256 do corpo esperado para testes.
  
  const rawBody = request.body ? JSON.stringify(request.body) : '';
  const path = request.url.split('?')[0] || '/';
  const signingString = buildSigningString(request.method, path, String(timestamp), rawBody);
  
  // Derivar chave de assinatura do keyHash (em prod: usar secret separada)
  const derivedKey = createHmac('sha256', apiKey.keyHash)
    .update(apiKey.merchantId)
    .digest();
  
  const expectedSig = createHmac('sha256', derivedKey)
    .update(signingString)
    .digest('hex');

  const sigBuffer = Buffer.from(String(signature), 'hex');
  const expectedBuffer = Buffer.from(expectedSig, 'hex');

  if (!safeCompare(sigBuffer, expectedBuffer)) {
    void reply.code(401).send({ error: 'Invalid signature' });
    return;
  }

  // Atualizar lastUsedAt assincronamente (não bloquear resposta)
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
 * Gera um par de API Key + Secret para um merchant.
 * Retorna o secret APENAS nesta chamada (nunca armazenado em claro).
 */
export async function generateMerchantApiKey(
  merchantId: string,
  name: string,
): Promise<{ keyId: string; prefix: string; secret: string }> {
  const { randomBytes, createHash } = await import('node:crypto');
  
  const rawSecret = `psk_${randomBytes(32).toString('hex')}`;
  const prefix = rawSecret.slice(0, 12);
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
 * Assina uma requisição para teste/integração.
 */
export function signRequest(
  secret: string,
  method: string,
  path: string,
  timestamp: number,
  body?: unknown,
): string {
  const rawBody = body ? JSON.stringify(body) : '';
  const signingString = buildSigningString(method, path, String(timestamp), rawBody);
  const derivedKey = createHmac('sha256', secret).update('signing').digest();
  return createHmac('sha256', derivedKey).update(signingString).digest('hex');
}