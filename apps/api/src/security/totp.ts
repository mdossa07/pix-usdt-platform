import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const CODE_RANGE = 10 ** DIGITS;

export function encodeBase32(input: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let output = '';

  for (const byte of input) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('invalid_totp_secret');
  }

  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

function generateCode(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (
    ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff)
  );

  return String(binary % CODE_RANGE).padStart(DIGITS, '0');
}

export function matchTotpCounter(
  secret: string,
  suppliedCode: string,
  nowMs = Date.now(),
  window = 1,
): number | null {
  if (!/^\\d{6}$/.test(suppliedCode)) return null;
  if (!Number.isFinite(nowMs) || nowMs < 0 || !Number.isInteger(window) || window < 0 || window > 2) {
    return null;
  }

  let key: Buffer;
  try {
    key = decodeBase32(secret);
  } catch {
    return null;
  }

  if (key.length < 16) return null;

  const currentCounter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  const supplied = Buffer.from(suppliedCode, 'ascii');
  for (let drift = -window; drift <= window; drift += 1) {
    const candidateCounter = currentCounter + drift;
    if (candidateCounter < 0) continue;
    const expected = Buffer.from(generateCode(secret, candidateCounter), 'ascii');
    if (timingSafeEqual(expected, supplied)) return candidateCounter;
  }
  return null;
}

export function verifyTotp(secret: string, suppliedCode: string, nowMs = Date.now(), window = 1): boolean {
  return matchTotpCounter(secret, suppliedCode, nowMs, window) !== null;
}

export function buildTotpProvisioningUri(account: string, secret: string, issuer = 'PixSplit'): string {
  const label = `${issuer}:${account}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}
