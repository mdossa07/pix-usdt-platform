import { resolveBrowserApiBaseUrl } from './api-url';

export const API_BASE_URL = resolveBrowserApiBaseUrl(process.env.NEXT_PUBLIC_API_URL, process.env.NODE_ENV ?? 'development');

const AUTH_COOKIE_CSRF_EXEMPT_PATHS = new Set([
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/2fa/verify',
]);

async function getCsrfToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const cached = window.sessionStorage.getItem('pixsplit_csrf');
  if (cached) return cached;

  const response = await fetch(`${API_BASE_URL}/v1/auth/csrf`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as { csrfToken?: string };
  if (!response.ok || typeof payload.csrfToken !== 'string') return null;

  window.sessionStorage.setItem('pixsplit_csrf', payload.csrfToken);
  return payload.csrfToken;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  // Legacy bearer tokens remain accepted during the transition. New browser
  // sessions use HttpOnly cookies; the localStorage marker is never a token.
  if (token?.startsWith('eyJ')) headers.set('Authorization', `Bearer ${token}`);

  const method = (options.method ?? 'GET').toUpperCase();
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (mutating && !AUTH_COOKIE_CSRF_EXEMPT_PATHS.has(path) && !headers.has('Authorization')) {
    const csrfToken = await getCsrfToken();
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload as T;
}
