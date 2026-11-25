import { timingSafeEqual } from 'node:crypto';

/**
 * Compares the Prometheus scrape bearer token without leaking the matching
 * prefix/length through a normal string equality comparison.
 */
export function isValidMetricsBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!/^[\x21-\x7E]{32,256}$/.test(expectedToken)) return false;
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) return false;

  const suppliedToken = authorizationHeader.slice('Bearer '.length);
  if (!/^[\x21-\x7E]{32,256}$/.test(suppliedToken)) return false;
  const expected = Buffer.from(expectedToken, 'ascii');
  const supplied = Buffer.from(suppliedToken, 'ascii');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
