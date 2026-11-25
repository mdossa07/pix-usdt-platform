export const ADMIN_RESPONSE_CACHE_CONTROL = 'no-store';
export const ADMIN_RESPONSE_PRAGMA = 'no-cache';

/** Match only API administrator routes, ignoring query parameters. */
export function isAdminApiRoute(url: string): boolean {
  const pathname = url.split('?', 1)[0] ?? '';
  return pathname.startsWith('/v1/admin/');
}

/** Apply the private-response cache policy without changing other API routes. */
export function applyAdminResponseCachePolicy(
  url: string,
  setHeader: (name: string, value: string) => void,
): void {
  if (!isAdminApiRoute(url)) return;
  setHeader('Cache-Control', ADMIN_RESPONSE_CACHE_CONTROL);
  setHeader('Pragma', ADMIN_RESPONSE_PRAGMA);
}
