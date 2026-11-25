import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  PAYMENTS_MODE: z.enum(['mock', 'sandbox', 'live']).default('mock'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PII_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  FOXBIT_API_BASE_URL: z.string().url().default('https://api.foxbit.com.br/rest/v3'),
  FOXBIT_API_KEY: z.string().optional().default(''),
  FOXBIT_API_SECRET: z.string().optional().default(''),
  FOXBIT_WEBHOOK_SECRET: z.string().optional().default(''),
  PLATFORM_COMMISSION_BPS: z.coerce.number().int().min(200).max(200).default(200),
  MOCK_USDT_PER_BRL: z.string().regex(/^\d+(\.\d{1,6})?$/).default('0.180000'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  METRICS_BEARER_TOKEN: z.string().refine(value => value === '' || /^[\x21-\x7E]{32,256}$/.test(value), 'METRICS_BEARER_TOKEN must be empty or 32-256 visible ASCII characters').default(''),

  // TransFi v3 (COBO/POBO)
  PAYMENT_PROVIDER: z.enum(['foxbit', 'transfi']).default('foxbit'),
  TRANSFI_USERNAME: z.string().optional().default(''),
  TRANSFI_PASSWORD: z.string().optional().default(''),
  TRANSFI_MID: z.string().optional().default(''),
  TRANSFI_WEBHOOK_SECRET: z.string().optional().default(''),
  TRANSFI_BASE_URL: z.string().url().default('https://sandbox-api.transfi.com'),
});

export const config = schema.parse(process.env);

// Production can serve the application while financial execution remains mock-only.
// Real/sandbox execution is blocked until conversion quotes, recipient registration,
// Travel Rule and both payout legs are certified end-to-end.
if (config.PAYMENTS_MODE !== 'mock') {
  throw new Error('PROVIDER_HOMOLOGATION_REQUIRED: use PAYMENTS_MODE=mock until the complete provider flow is certified.');
}
