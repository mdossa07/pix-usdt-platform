import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('API exposes production start and environment-driven migration commands', () => {
  const api = readJson('../apps/api/package.json');
  assert.equal(api.scripts.start, 'node dist/server.js');
  assert.equal(api.scripts['db:generate:deploy'], 'prisma generate --schema prisma/schema.prisma');
  assert.equal(api.scripts['db:migrate:deploy'], 'prisma migrate deploy --schema prisma/schema.prisma');
});

test('web service starts Next.js on Railway injected host and port', () => {
  const web = readJson('../apps/web/package.json');
  assert.equal(web.scripts.start, 'next start -H 0.0.0.0');
});

test('root workspace exposes explicit API/web production start commands', () => {
  const root = readJson('../package.json');
  assert.equal(root.scripts['start:api'], 'pnpm --filter @pixsplit/api start');
  assert.equal(root.scripts['start:web'], 'pnpm --filter @pixsplit/web start');
  assert.equal(root.scripts['db:generate:deploy'], 'pnpm --filter @pixsplit/api db:generate:deploy');
  assert.equal(root.scripts['db:migrate:deploy'], 'pnpm --filter @pixsplit/api db:migrate:deploy');
});

test('API defaults to platform-provided PORT while retaining API_PORT override', () => {
  const config = readFileSync(new URL('../apps/api/src/config.ts', import.meta.url), 'utf8');
  assert.match(config, /API_PORT:\s*z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.default\(Number\(process\.env\.PORT \?\? 4000\)\)/);
});
