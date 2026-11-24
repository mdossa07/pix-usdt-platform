export interface AdminMfaGuardInput {
  role: string;
  twoFactorEnabled: boolean;
  sessionTwoFactorVerified: boolean;
  method: string;
  url: string;
}

export type AdminMfaGuardError = 'two_factor_enrollment_required' | 'two_factor_required';

const setupRoutes = new Set([
  'GET /v1/admin/2fa/status',
  'POST /v1/admin/2fa/setup',
  'POST /v1/admin/2fa/enable',
]);

export function getAdminMfaGuardError(input: AdminMfaGuardInput): AdminMfaGuardError | null {
  if (input.role !== 'SUPER_ADMIN') return null;

  let pathname: string;
  try {
    pathname = new URL(input.url, 'http://pixsplit.local').pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith('/v1/admin/')) return null;

  const routeKey = `${input.method.toUpperCase()} ${pathname}`;
  if (!input.twoFactorEnabled) {
    return setupRoutes.has(routeKey) ? null : 'two_factor_enrollment_required';
  }

  return input.sessionTwoFactorVerified ? null : 'two_factor_required';
}
