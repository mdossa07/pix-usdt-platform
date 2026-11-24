import { PrismaClient, PaymentStatus, TransferStatus } from '@prisma/client';
import { enqueueSettlement } from '../queues/producers.js';

/**
 * Financial reconciliation service.
 * Identifies stuck, incomplete or divergent payments and schedules safe reprocessing.
 * Never mutates financial state directly — only enqueues recovery jobs.
 */
export class ReconciliationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Main reconciliation loop. Run periodically (e.g., every 5 minutes).
   * Returns the number of payments enqueued for recovery.
   */
  async reconcile(): Promise<number> {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 min
    const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 min

    let recovered = 0;

    // 1. PIX confirmed but no conversion started (>5min)
    const pixStuck = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PIX_CONFIRMED,
        updatedAt: { lt: staleThreshold },
      },
      select: { id: true, amountBrlCents: true },
    });
    for (const p of pixStuck) {
      await enqueueSettlement(p.id, p.amountBrlCents);
      recovered++;
    }

    // 2. Conversion done but settlement not started (>5min)
    const conversionStuck = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.CRYPTO_CREDITED,
        updatedAt: { lt: staleThreshold },
      },
      select: { id: true, amountBrlCents: true },
    });
    for (const p of conversionStuck) {
      await enqueueSettlement(p.id, p.amountBrlCents);
      recovered++;
    }

    // 3. Merchant payout stuck in PROCESSING (>30min)
    const merchantStuck = await this.prisma.payment.findMany({
      where: {
        merchantTransferStatus: TransferStatus.PROCESSING,
        updatedAt: { lt: stuckThreshold },
      },
      select: { id: true, amountBrlCents: true },
    });
    for (const p of merchantStuck) {
      await enqueueSettlement(p.id, p.amountBrlCents);
      recovered++;
    }

    // 4. Platform commission stuck in PROCESSING (>30min)
    const platformStuck = await this.prisma.payment.findMany({
      where: {
        platformTransferStatus: TransferStatus.PROCESSING,
        updatedAt: { lt: stuckThreshold },
      },
      select: { id: true, amountBrlCents: true },
    });
    for (const p of platformStuck) {
      await enqueueSettlement(p.id, p.amountBrlCents);
      recovered++;
    }

    // 5. One leg completed, other still pending (>5min) — partial settlement
    const partialStuck = await this.prisma.payment.findMany({
      where: {
        OR: [
          {
            merchantTransferStatus: TransferStatus.COMPLETED,
            platformTransferStatus: { in: [TransferStatus.CREATED, TransferStatus.SUBMITTED, TransferStatus.PROCESSING] },
            updatedAt: { lt: staleThreshold },
          },
          {
            platformTransferStatus: TransferStatus.COMPLETED,
            merchantTransferStatus: { in: [TransferStatus.CREATED, TransferStatus.SUBMITTED, TransferStatus.PROCESSING] },
            updatedAt: { lt: staleThreshold },
          },
        ],
      },
      select: { id: true, amountBrlCents: true },
    });
    for (const p of partialStuck) {
      await enqueueSettlement(p.id, p.amountBrlCents);
      recovered++;
    }

    return recovered;
  }
}