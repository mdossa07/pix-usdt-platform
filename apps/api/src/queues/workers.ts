import { Worker } from 'bullmq';
import { createQueueConnection } from './connection.js';
import { PrismaClient } from '@prisma/client';
import { PaymentOrchestrator } from '../payments/orchestrator.js';
import { createPaymentProvider } from '../providers/provider-factory.js';
import { config } from '../config.js';

const prisma = new PrismaClient();
const provider = createPaymentProvider();
const orchestrator = new PaymentOrchestrator(prisma, provider, {
  commissionBps: config.PLATFORM_COMMISSION_BPS,
  mockRate: config.MOCK_USDT_PER_BRL,
  mode: config.PAYMENTS_MODE,
});

/**
 * Processes confirmed PIX payments asynchronously.
 * Triggered by webhook ingestion after signature validation and idempotency check.
 */
export function startSettlementWorker(): Worker {
  return new Worker(
    'payment-settlement',
    async (job) => {
      const { paymentId, brlCents } = job.data as { paymentId: string; brlCents: number };
      await orchestrator.handlePixConfirmed(paymentId, BigInt(brlCents));
    },
    { connection: createQueueConnection(), concurrency: 3 },
  );
}

/**
 * Retries failed transfers with exponential backoff.
 * Only re-processes legs that are in FAILED status and have not exceeded max attempts.
 */
export function startRetryWorker(): Worker {
  return new Worker(
    'transfer-retry',
    async (job) => {
      const { paymentId, kind } = job.data as { paymentId: string; kind: 'MERCHANT_PAYOUT' | 'PLATFORM_COMMISSION' };
      if (kind === 'MERCHANT_PAYOUT') {
        await orchestrator.settleMerchantPayout(paymentId);
      } else {
        await orchestrator.settlePlatformCommission(paymentId);
      }
    },
    { connection: createQueueConnection(), concurrency: 2 },
  );
}