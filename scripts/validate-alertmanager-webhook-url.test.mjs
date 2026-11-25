import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateAlertmanagerWebhookUrl,
  validateAlertmanagerWebhookUrlFile,
} from './validate-alertmanager-webhook-url.mjs';

test('accepts HTTPS webhook URLs, including provider query tokens', () => {
  const parsed = validateAlertmanagerWebhookUrl('https://alerts.example.invalid/hook?token=opaque');
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'alerts.example.invalid');
});

test('rejects HTTP destinations', () => {
  assert.throws(
    () => validateAlertmanagerWebhookUrl('http://alerts.example.invalid/hook'),
    /ALERTMANAGER_WEBHOOK_URL_MUST_USE_HTTPS/,
  );
});

test('rejects malformed and credential-bearing destinations', () => {
  assert.throws(
    () => validateAlertmanagerWebhookUrl('not-a-url'),
    /ALERTMANAGER_WEBHOOK_URL_MUST_BE_ABSOLUTE/,
  );
  assert.throws(
    () => validateAlertmanagerWebhookUrl('https://user:password@alerts.example.invalid/hook'),
    /ALERTMANAGER_WEBHOOK_URL_MUST_NOT_CONTAIN_CREDENTIALS/,
  );
});

test('rejects fragments and whitespace around the destination', () => {
  assert.throws(
    () => validateAlertmanagerWebhookUrl('https://alerts.example.invalid/hook#fragment'),
    /ALERTMANAGER_WEBHOOK_URL_MUST_NOT_CONTAIN_FRAGMENT/,
  );
  assert.throws(
    () => validateAlertmanagerWebhookUrl(' https://alerts.example.invalid/hook '),
    /ALERTMANAGER_WEBHOOK_URL_INVALID/,
  );
});

test('reads the URL from a file without returning or printing its contents', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pixsplit-alertmanager-'));
  const secretFile = join(directory, 'webhook-url');
  try {
    writeFileSync(secretFile, 'https://alerts.example.invalid/hook\\n', { mode: 0o600 });
    const parsed = validateAlertmanagerWebhookUrlFile(secretFile);
    assert.equal(parsed.hostname, 'alerts.example.invalid');
    assert.throws(
      () => validateAlertmanagerWebhookUrlFile(join(directory, 'missing')),
      /ENOENT/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
