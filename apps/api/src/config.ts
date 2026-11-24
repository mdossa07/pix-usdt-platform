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
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // TransFi v3 (COBO/POBO)
  PAYMENT_PROVIDER: z.enum(['foxbit', 'transfi']).default('foxbit'),
  TRANSFI_USERNAME: z.string().optional().default(''),
  TRANSFI_PASSWORD: z.string().optional().default(''),
  TRANSFI_MID: z.string().optional().default(''),
  TRANSFI_WEBHOOK_SECRET: z.string().optional().default(''),
  TRANSFI_BASE_URL: z.string().url().default('https://sandbox-api.transfi.com'),
});

export const config = schema.parse(process.env);

// Fail closed for production; sandbox allowed for integration testing with real provider credentials.
if (config.NODE_ENV === 'production' && config.PAYMENTS_MODE !== 'live') {
  throw new Error('Production requires PAYMENTS_MODE=live and explicit provider credentials.');
}
if (config.PAYMENTS_MODE === 'live' && config.NODE_ENV !== 'production') {
  throw new Error('PAYMENTS_MODE=live is only allowed in production environment.');
}
