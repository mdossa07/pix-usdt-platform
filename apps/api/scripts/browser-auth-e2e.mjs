import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://localhost:4000';
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3000';
const playwrightPackagePath = process.env.PLAYWRIGHT_PACKAGE_PATH;
if (!playwrightPackagePath) throw new Error('PLAYWRIGHT_PACKAGE_PATH is required');

const { chromium } = await import(pathToFileURL(join(playwrightPackagePath, 'index.mjs')).href);
const prisma = new PrismaClient();
const email = `pixsplit-browser-${randomUUID()}@example.invalid`;
const password = 'PixSplitBrowserE2E#2026';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function cleanupTestMerchant() {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, merchant: { select: { id: true } } },
  });
  if (!user) return;
  if (user.merchant) await prisma.merchant.deleteMany({ where: { id: user.merchant.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error') console.error('BROWSER_CONSOLE_ERROR:', message.text());
  });
  page.on('pageerror', error => console.error('BROWSER_PAGE_ERROR:', error.message));
  page.on('requestfailed', request => console.error('BROWSER_REQUEST_FAILED:', request.url(), request.failure()?.errorText));

  await page.goto(WEB_ORIGIN + '/register', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Seu nome').fill('PixSplit Browser E2E');
  await page.getByPlaceholder('voce@empresa.com').fill(email);
  await page.getByPlaceholder('Nome cadastrado').fill('PixSplit Browser E2E Ltda');
  await page.getByPlaceholder('00000000000').fill('12345678000199');
  await page.getByPlaceholder('Crie uma senha forte').fill(password);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.waitForURL('**/merchant', { timeout: 60_000 });

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

  console.log('Browser auth E2E passed: registration, HttpOnly cookie, authenticated API, CSRF rejection, session listing, logout and old-cookie rejection.');
  console.log(`Test merchant: ${email}`);
  await context.close();
} finally {
  await browser.close();
  try {
    await cleanupTestMerchant();
  } finally {
    await prisma.$disconnect();
  }
}
