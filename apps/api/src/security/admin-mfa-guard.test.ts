import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdminMfaGuardError } from './admin-mfa-guard.js';

test('does not enforce superadmin MFA on non-admin routes or non-superadmin users', () => {
  assert.equal(getAdminMfaGuardError({
    role: 'MERCHANT',
    twoFactorEnabled: false,
    sessionTwoFactorVerified: false,
    method: 'POST',
    url: '/v1/admin/payments',
  }), null);
  assert.equal(getAdminMfaGuardError({
    role: 'SUPER_ADMIN',
    twoFactorEnabled: false,
    sessionTwoFactorVerified: false,
    method: 'POST',
    url: '/v1/auth/logout',
  }), null);
});

test('an unenrolled superadmin may only read 2FA status and complete setup', () => {
  const base = { role: 'SUPER_ADMIN', twoFactorEnabled: false, sessionTwoFactorVerified: false };
  assert.equal(getAdminMfaGuardError({ ...base, method: 'GET', url: '/v1/admin/2fa/status' }), null);
  assert.equal(getAdminMfaGuardError({ ...base, method: 'POST', url: '/v1/admin/2fa/setup' }), null);
  assert.equal(getAdminMfaGuardError({ ...base, method: 'POST', url: '/v1/admin/2fa/enable' }), null);
  assert.equal(getAdminMfaGuardError({ ...base, method: 'GET', url: '/v1/admin/payments' }), 'two_factor_enrollment_required');
  assert.equal(getAdminMfaGuardError({ ...base, method: 'GET', url: '/v1/admin/provider-status' }), 'two_factor_enrollment_required');
  assert.equal(getAdminMfaGuardError({ ...base, method: 'POST', url: '/v1/admin/2fa/recovery-codes/regenerate' }), 'two_factor_enrollment_required');
});

test('enabled superadmins need an MFA-verified session for every admin endpoint', () => {
  const base = { role: 'SUPER_ADMIN', twoFactorEnabled: true, sessionTwoFactorVerified: false };
  assert.equal(getAdminMfaGuardError({ ...base, method: 'GET', url: '/v1/admin/2fa/status' }), 'two_factor_required');
  assert.equal(getAdminMfaGuardError({ ...base, method: 'GET', url: '/v1/admin/payments' }), 'two_factor_required');
  assert.equal(getAdminMfaGuardError({ ...base, method: 'POST', url: '/v1/admin/merchants/123' }), 'two_factor_required');
});

test('a TOTP-verified superadmin session can access admin routes', () => {
  const base = { role: 'SUPER_ADMIN', twoFactorEnabled: true, sessionTwoFactorVerified: true };
  assert.equal(getAdminMfaGuardError({ ...base, method: 'GET', url: '/v1/admin/payments?take=20' }), null);
  assert.equal(getAdminMfaGuardError({ ...base, method: 'POST', url: '/v1/admin/2fa/recovery-codes/regenerate' }), null);
});
