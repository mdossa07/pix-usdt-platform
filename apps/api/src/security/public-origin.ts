export function getPublicAppOrigin(nodeEnv: string, appUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error('APP_URL_MUST_BE_ABSOLUTE_URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('APP_URL_MUST_USE_HTTP_OR_HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('APP_URL_MUST_NOT_CONTAIN_CREDENTIALS');
  }
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('PRODUCTION_APP_URL_MUST_USE_HTTPS');
  }

  return parsed.origin;
}
