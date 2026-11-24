import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieHeader,
  clearSessionCookieHeader,
  isValidCsrfRequest,
  readCookie,
} from './session-cookie.js';

test('reads a named cookie without confusing similarly named cookies', () => {
  assert.equal(readCookie('other=abc; pixsplit_session=eyJhbGciOiJIUzI1NiJ9.sig; flag=1', SESSION_COOKIE_NAME), 'eyJhbGciOiJIUzI1NiJ9.sig');
  assert.equal(readCookie('pixsplit_session_extra=wrong', SESSION_COOKIE_NAME), null);
  assert.equal(readCookie(undefined, SESSION_COOKIE_NAME), null);
});

test('builds an HttpOnly production session cookie with Secure and SameSite=None', () => {
  const header = buildSessionCookieHeader('header.payload.signature', { secure: true, sameSite: 'None' });
  assert.match(header, /^pixsplit_session=/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=None/);
  assert.match(header, /Path=\//);
  assert.match(header, /Max-Age=7200/);
});

test('rejects insecure SameSite=None cookies and unsafe cookie values', () => {
  assert.throws(() => buildSessionCookieHeader('token', { secure: false, sameSite: 'None' }), /require Secure/);
  assert.throws(() => buildSessionCookieHeader('token;injected=value', { secure: true, sameSite: 'None' }), /invalid_session_cookie_value/);
});

test('clears the session cookie with matching scope and attributes', () => {
  const header = clearSessionCookieHeader({ secure: true, sameSite: 'None' });
  assert.match(header, /^pixsplit_session=;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /Max-Age=0/);
  assert.match(header, /Expires=Thu, 01 Jan 1970/);
});

test('requires an exact trusted origin and matching CSRF token', () => {
  const base = {
    origin: 'https://app.pixsplit.example',
    expectedOrigin: 'https://app.pixsplit.example/',
    expectedToken: 'a'.repeat(64),
    suppliedToken: 'a'.repeat(64),
  };
  assert.equal(isValidCsrfRequest(base), true);
  assert.equal(isValidCsrfRequest({ ...base, origin: 'https://evil.example' }), false);
  assert.equal(isValidCsrfRequest({ ...base, suppliedToken: 'b'.repeat(64) }), false);
  assert.equal(isValidCsrfRequest({ ...base, suppliedToken: undefined }), false);
});
