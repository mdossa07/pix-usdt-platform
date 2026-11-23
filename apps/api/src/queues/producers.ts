import { Queue } from 'bullmq';
import { createQueueConnection } from './connection.js';

const settlementQueue = new Queue('payment-settlement', { connection: createQueueConnection() });
const retryQueue = new Queue('transfer-retry', { connection: createQueueConnection() });

/**
 * Enqueues a confirmed PIX payment for async settlement.
 * Idempotency is enforced by the orchestrator; this queue only guarantees delivery.
 */
export async function enqueueSettlement(paymentId: string, brlCents: bigint): Promise<void> {
 await settlementQueue.add(
 'settle',
 { paymentId, brlCents: Number(brlCents) },
 { jobId: paymentId, removeOnComplete: true, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
 );
}

/**
 * Schedules a retry for a failed transfer leg.
 * Used by reconciliation jobs and manual admin triggers.
 */
export async function enqueueTransferRetry(paymentId: string, kind: 'MERCHANT_PAYOUT' | 'PLATFORM_COMMISSION'): Promise<void> {
 await retryQueue.add(
 'retry',
 { paymentId, kind },
 { jobId: `${paymentId}:${kind}`, removeOnComplete: true, attempts: 5, backoff: { type: 'exponential', delay: 10000 } },
 );
}

export async function closeQueues(): Promise<void> {
 await settlementQueue.close();
 await retryQueue.close();
}