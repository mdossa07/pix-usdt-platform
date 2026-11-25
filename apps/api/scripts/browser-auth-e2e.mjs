import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://localhost:4000';
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3000';
const playwrightPackagePath = process.env.PLAYWRIGHT_PACKAGE_PATH;
if (!playwrightPackagePath) throw new Error('PLAYWRIGHT_PACKAGE_PATH is required');

const { chromium } = await import(pathToFileURL(join(playwrightPackagePath, 'index.mjs')).href);
const prisma = new PrismaClient();
const email = `pixsplit-browser-${randomUUID()}@example.invalid`;
const password = 'PixSplitBrowserE2E#2026';
const adminEmail = `pixsplit-admin-browser-${randomUUID()}@example.invalid`;
const adminPassword = 'PixSplitAdminBrowserE2E#2026';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function cleanupTestUsers() {
  for (const testEmail of [email, adminEmail]) {
    const user = await prisma.user.findUnique({
      where: { email: testEmail },
      select: { id: true, merchant: { select: { id: true } } },
    });
    if (!user) continue;
    if (user.merchant) await prisma.merchant.deleteMany({ where: { id: user.merchant.id } });
    await prisma.auditEvent.deleteMany({ where: { actorUserId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error') console.error('BROWSER_CONSOLE_ERROR:', message.text());
  });
  page.on('pageerror', error => console.error('BROWSER_PAGE_ERROR:', error.message));
  page.on('requestfailed', request => console.error('BROWSER_REQUEST_FAILED:', request.url(), request.failure()?.errorText));
  page.on('response', response => {
    if (response.url().includes('/v1/')) {
      console.log('BROWSER_API_RESPONSE:', response.status(), response.request().method(), response.url());
    }
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) console.log('BROWSER_NAVIGATION:', frame.url());
  });

  await page.goto(WEB_ORIGIN + '/register', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Seu nome').fill('PixSplit Browser E2E');
  await page.getByPlaceholder('voce@empresa.com').fill(email);
  await page.getByPlaceholder('Nome cadastrado').fill('PixSplit Browser E2E Ltda');
  await page.getByPlaceholder('00000000000').fill('12345678000199');
  await page.getByPlaceholder('Crie uma senha forte').fill(password);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.waitForURL('**/merchant', { timeout: 60_000, waitUntil: 'domcontentloaded' });
  const registrationStorage = await page.evaluate(() => ({
    url: location.href,
    marker: localStorage.getItem('pixsplit_authenticated'),
    legacyToken: localStorage.getItem('pixsplit_token'),
    csrf: sessionStorage.getItem('pixsplit_csrf'),
  }));
  console.log('REGISTRATION_BROWSER_STATE:', JSON.stringify(registrationStorage));
  assert.equal(registrationStorage.marker, '1', 'registration must persist the browser authentication marker');
  assert.ok(registrationStorage.csrf, 'registration must persist the CSRF token');

  const identity = await page.evaluate(async apiOrigin => {
    const response = await fetch(apiOrigin + '/v1/me', {
      credentials: 'include',
      cache: 'no-store',
    });
    return {
      status: response.status,
      payload: await response.json(),
    };
  }, API_ORIGIN);
  assert.equal(identity.status, 200, 'the registered browser session must authenticate /v1/me');
  assert.equal(identity.payload.role, 'MERCHANT');

  const sessions = await page.evaluate(async apiOrigin => {
    const response = await fetch(apiOrigin + '/v1/auth/sessions', {
      credentials: 'include',
      cache: 'no-store',
    });
    return { status: response.status, payload: await response.json() };
  }, API_ORIGIN);
  assert.equal(sessions.status, 200);
  assert.ok(sessions.payload.sessions.some(session => session.current));

  const cookies = await context.cookies(API_ORIGIN);
  const sessionCookie = cookies.find(cookie => cookie.name === 'pixsplit_session');
  assert.ok(sessionCookie, 'the API must issue its browser session cookie');
  assert.equal(sessionCookie.httpOnly, true, 'the session cookie must be HttpOnly');
  const javascriptCanReadSession = await page.evaluate(() => document.cookie.includes('pixsplit_session='));
  assert.equal(javascriptCanReadSession, false, 'JavaScript must not read the session cookie');

  const missingCsrfStatus = await page.evaluate(async apiOrigin => {
    const response = await fetch(apiOrigin + '/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    return response.status;
  }, API_ORIGIN);
  assert.equal(missingCsrfStatus, 403, 'cookie-authenticated mutations without CSRF must be rejected');

  const sessionAfterRejectedMutation = await page.evaluate(async apiOrigin => {
    const response = await fetch(apiOrigin + '/v1/me', {
      credentials: 'include',
      cache: 'no-store',
    });
    return response.status;
  }, API_ORIGIN);
  assert.equal(sessionAfterRejectedMutation, 200, 'a rejected CSRF request must not revoke the current session');

  const logoutButton = page.locator('button[aria-label="Sair da conta"]');
  try {
    await logoutButton.waitFor({ state: 'visible', timeout: 10_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyText: document.body.innerText.slice(0, 3000),
      hasWorkspaceHeader: Boolean(document.querySelector('.workspace-topbar')),
      hasLogoutButton: Boolean(document.querySelector('button[aria-label="Sair da conta"]')),
    }));
    console.error('MERCHANT_DASHBOARD_DIAGNOSTICS:', JSON.stringify(diagnostics));
    throw error;
  }
  await logoutButton.click();
  await page.waitForURL('**/login', { timeout: 30_000 });

  const clientState = await page.evaluate(() => ({
    authenticated: localStorage.getItem('pixsplit_authenticated'),
    csrf: sessionStorage.getItem('pixsplit_csrf'),
    visibleCookie: document.cookie.includes('pixsplit_session='),
  }));
  assert.equal(clientState.authenticated, null, 'logout clears the browser authentication marker');
  assert.equal(clientState.csrf, null, 'logout clears the cached CSRF token');
  assert.equal(clientState.visibleCookie, false);

  const remainingCookies = await context.cookies(API_ORIGIN);
  assert.equal(remainingCookies.some(cookie => cookie.name === 'pixsplit_session'), false, 'logout clears the browser cookie');

  const replay = await fetch(API_ORIGIN + '/v1/me', {
    headers: { cookie: `pixsplit_session=${sessionCookie.value}` },
    cache: 'no-store',
  });
  assert.equal(replay.status, 401, 'the old cookie must be rejected after server-side session revocation');

  // Create a real SUPER_ADMIN identity in the test database and verify the
  // browser can enter the admin panel using only the new HttpOnly cookie flow.
  await prisma.user.create({
    data: {
      email: adminEmail,
      fullName: 'PixSplit Admin Browser E2E',
      passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
      role: 'SUPER_ADMIN',
    },
  });

  await page.goto(WEB_ORIGIN + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('voce@empresa.com').fill(adminEmail);
  await page.getByPlaceholder('Sua senha').fill(adminPassword);
  await page.getByRole('button', { name: /Entrar/ }).click();
  await page.waitForURL('**/admin', { timeout: 60_000, waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Autenticação de dois fatores (TOTP)' }).waitFor({ state: 'visible', timeout: 30_000 });

  const adminIdentity = await page.evaluate(async apiOrigin => {
    const response = await fetch(apiOrigin + '/v1/me', {
      credentials: 'include',
      cache: 'no-store',
    });
    return { status: response.status, payload: await response.json() };
  }, API_ORIGIN);
  assert.equal(adminIdentity.status, 200, 'the admin layout must authenticate from the HttpOnly cookie');
  assert.equal(adminIdentity.payload.role, 'SUPER_ADMIN', 'the admin panel must verify the superadmin role server-side');

  const adminBrowserState = await page.evaluate(() => ({
    marker: localStorage.getItem('pixsplit_authenticated'),
    legacyToken: localStorage.getItem('token'),
    oldToken: localStorage.getItem('pixsplit_token'),
  }));
  assert.equal(adminBrowserState.marker, '1', 'admin login must persist only the non-secret browser marker');
  assert.equal(adminBrowserState.legacyToken, null, 'admin login must not persist a bearer token');
  assert.equal(adminBrowserState.oldToken, null, 'admin login must not persist a legacy bearer token');

  const adminCookies = await context.cookies(API_ORIGIN);
  const adminSessionCookie = adminCookies.find(cookie => cookie.name === 'pixsplit_session');
  assert.ok(adminSessionCookie, 'superadmin login must issue the HttpOnly session cookie');
  assert.equal(adminSessionCookie.httpOnly, true);

  await page.locator('button[aria-label="Sair da conta"]').first().click();
  await page.waitForURL('**/login', { timeout: 30_000 });

  const adminLogoutState = await page.evaluate(() => ({
    marker: localStorage.getItem('pixsplit_authenticated'),
    csrf: sessionStorage.getItem('pixsplit_csrf'),
  }));
  assert.equal(adminLogoutState.marker, null, 'admin logout clears the browser session marker');
  assert.equal(adminLogoutState.csrf, null, 'admin logout clears the cached CSRF token');

  const adminReplay = await fetch(API_ORIGIN + '/v1/me', {
    headers: { cookie: `pixsplit_session=${adminSessionCookie.value}` },
    cache: 'no-store',
  });
  assert.equal(adminReplay.status, 401, 'admin logout must revoke the old session server-side');

  console.log('Browser auth E2E passed: merchant registration/session/CSRF/logout and superadmin cookie-only login/admin access/logout revocation.');
  console.log(`Test merchant: ${email}`);
  console.log(`Test superadmin: ${adminEmail}`);
  await context.close();
} finally {
  await browser.close();
  try {
    await cleanupTestUsers();
  } finally {
    await prisma.$disconnect();
  }
}
