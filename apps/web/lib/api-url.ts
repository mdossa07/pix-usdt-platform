export function resolveBrowserApiBaseUrl(
  configuredUrl: string | undefined,
  nodeEnv: string,
): string {
  const value = configuredUrl?.trim() || (nodeEnv === 'production' ? '' : 'http://localhost:4000');
  if (!value) throw new Error('PRODUCTION_NEXT_PUBLIC_API_URL_REQUIRED');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('NEXT_PUBLIC_API_URL_MUST_BE_ABSOLUTE_URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_API_URL_MUST_USE_HTTP_OR_HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('NEXT_PUBLIC_API_URL_MUST_NOT_CONTAIN_CREDENTIALS');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('NEXT_PUBLIC_API_URL_MUST_NOT_CONTAIN_QUERY_OR_FRAGMENT');
  }
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('PRODUCTION_NEXT_PUBLIC_API_URL_MUST_USE_HTTPS');
  }

  return value.replace(/\/+$/, '');
}
