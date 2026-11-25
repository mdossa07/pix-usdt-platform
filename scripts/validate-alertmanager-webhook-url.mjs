import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateAlertmanagerWebhookUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error('ALERTMANAGER_WEBHOOK_URL_INVALID');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('ALERTMANAGER_WEBHOOK_URL_MUST_BE_ABSOLUTE');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('ALERTMANAGER_WEBHOOK_URL_MUST_USE_HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('ALERTMANAGER_WEBHOOK_URL_MUST_NOT_CONTAIN_CREDENTIALS');
  }
  if (parsed.hash) {
    throw new Error('ALERTMANAGER_WEBHOOK_URL_MUST_NOT_CONTAIN_FRAGMENT');
  }

  return parsed;
}

export function validateAlertmanagerWebhookUrlFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('ALERTMANAGER_WEBHOOK_URL_FILE_REQUIRED');
  }

  const value = readFileSync(filePath, 'utf8').trim();
  if (!value) throw new Error('ALERTMANAGER_WEBHOOK_URL_FILE_EMPTY');
  return validateAlertmanagerWebhookUrl(value);
}

function main() {
  try {
    validateAlertmanagerWebhookUrlFile(process.env.ALERTMANAGER_WEBHOOK_URL_FILE);
    process.stdout.write('Alertmanager webhook URL file is valid (HTTPS).\\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'ALERTMANAGER_WEBHOOK_URL_INVALID'}\\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) main();
