import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.e2e.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/payments/split.test.ts', 'src/payments/orchestrator.test.ts'],
    globals: false,
    environment: 'node',
    testTimeout: 60000,
    env: {
      DATABASE_URL: 'postgresql://pixsplit_test:pixsplit_test_pass@localhost:5433/pixsplit_test?schema=public',
      NODE_ENV: 'test',
      PAYMENTS_MODE: 'mock',
      JWT_SECRET: 'test-jwt-secret-not-for-prod-at-least-32-chars',
      PII_ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
      PLATFORM_COMMISSION_BPS: '200',
      MOCK_USDT_PER_BRL: '0.180000',
      REDIS_URL: 'redis://localhost:6379/1',
      ALLOW_INSECURE_SEED: 'true',
    },
  },
});