import { createHmac, timingSafeEqual } from 'node:crypto';

/** Foxbit Partner API V2: HMAC-SHA256 over the exact raw request bytes. */
export function verifyFoxbitWebhook(rawBody: Buffer, receivedSignature: string | undefined, secret: string): boolean {
  if (!receivedSignature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = Buffer.from(receivedSignature.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
}
