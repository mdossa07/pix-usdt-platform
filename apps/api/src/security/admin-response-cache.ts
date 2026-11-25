export const API_RESPONSE_CACHE_CONTROL = 'no-store';
export const API_RESPONSE_PRAGMA = 'no-cache';

/** Match versioned API routes only; keep health, metrics, and static assets separate. */
export function isVersionedApiRoute(url: string): boolean {
  const pathname = url.split('?', 1)[0] ?? '';
  return pathname.startsWith('/v1/');
}

/** Prevent browsers and intermediary caches from storing versioned API responses. */
export function applyVersionedApiResponseCachePolicy(
  url: string,
  setHeader: (name: string, value: string) => void,
): void {
  if (!isVersionedApiRoute(url)) return;
  setHeader('Cache-Control', API_RESPONSE_CACHE_CONTROL);
  setHeader('Pragma', API_RESPONSE_PRAGMA);
}
