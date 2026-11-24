import { timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'pixsplit_session';
export const SESSION_MAX_AGE_SECONDS = 2 * 60 * 60;

export type SessionSameSite = 'Lax' | 'None';

export interface SessionCookieOptions {
  secure: boolean;
  sameSite: SessionSameSite;
  maxAgeSeconds?: number;
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    const value = item.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function cookieAttributes(options: SessionCookieOptions): string {
  if (options.sameSite === 'None' && !options.secure) {
    throw new Error('SameSite=None cookies require Secure');
  }
  const maxAge = options.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS;
  if (!Number.isInteger(maxAge) || maxAge < 0) throw new Error('invalid_cookie_max_age');

  return [
    'Path=/',
    'HttpOnly',
    `SameSite=${options.sameSite}`,
    `Max-Age=${maxAge}`,
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

export function buildSessionCookieHeader(token: string, options: SessionCookieOptions): string {
  if (!token || /[;\r\n]/.test(token)) throw new Error('invalid_session_cookie_value');
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(options)}`;
}

export function clearSessionCookieHeader(options: SessionCookieOptions): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes({ ...options, maxAgeSeconds: 0 })}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function isValidCsrfRequest(input: {
  origin: string | undefined;
  expectedOrigin: string;
  expectedToken: string | undefined;
  suppliedToken: string | undefined;
}): boolean {
  if (!input.origin || !input.expectedToken || !input.suppliedToken) return false;

  let actualOrigin: string;
  let expectedOrigin: string;
  try {
    actualOrigin = new URL(input.origin).origin;
    expectedOrigin = new URL(input.expectedOrigin).origin;
  } catch {
    return false;
  }
  if (actualOrigin !== expectedOrigin) return false;

  const expected = Buffer.from(input.expectedToken, 'utf8');
  const supplied = Buffer.from(input.suppliedToken, 'utf8');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
