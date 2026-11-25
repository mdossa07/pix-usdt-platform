import assert from 'node:assert/strict';
import test from 'node:test';
import { checkApplicationReadiness } from './readiness.js';

test('reports ready only when PostgreSQL and Redis are available', async () => {
  const result = await checkApplicationReadiness({
    database: async () => undefined,
    redis: async () => 'PONG',
  });

  assert.deepEqual(result, {
    ready: true,
    checks: { database: true, redis: true },
  });
});

test('marks only PostgreSQL unavailable without exposing internal errors', async () => {
  const result = await checkApplicationReadiness({
    database: async () => { throw new Error('database connection string must not leak'); },
    redis: async () => 'PONG',
  });

  assert.deepEqual(result, {
    ready: false,
    checks: { database: false, redis: true },
  });
  assert.equal(JSON.stringify(result).includes('connection string'), false);
});

test('marks only Redis unavailable', async () => {
  const result = await checkApplicationReadiness({
    database: async () => undefined,
    redis: async () => { throw new Error('redis password must not leak'); },
  });

  assert.deepEqual(result, {
    ready: false,
    checks: { database: true, redis: false },
  });
  assert.equal(JSON.stringify(result).includes('redis password'), false);
});

test('reports both dependencies unavailable without rejecting the probe', async () => {
  const result = await checkApplicationReadiness({
    database: async () => { throw new Error('database down'); },
    redis: async () => { throw new Error('redis down'); },
  });

  assert.deepEqual(result, {
    ready: false,
    checks: { database: false, redis: false },
  });
});
