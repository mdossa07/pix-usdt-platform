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
  PLATFORM_COMMISSION_BPS: z.coerce.number().int().min(1).max(1000).default(200),
  MOCK_USDT_PER_BRL: z.string().regex(/^\d+(\.\d{1,6})?$/).default('0.180000'),
});

export const config = schema.parse(process.env);

// Fail closed: this release intentionally exposes no live or provider sandbox money movement.
if (config.PAYMENTS_MODE !== 'mock') {
  throw new Error('PAYMENTS_MODE must remain mock until the Foxbit partner flow is approved and implemented.');
}
if (config.NODE_ENV === 'production') {
  throw new Error('This starter is not production-ready. Do not deploy with financial operations enabled.');
}
