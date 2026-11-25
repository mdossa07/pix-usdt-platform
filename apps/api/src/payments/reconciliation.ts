import { PrismaClient, PaymentStatus, TransferStatus } from '@prisma/client';
type SettlementEnqueuer = (paymentId: string, brlCents: bigint) => Promise<void>;
type ReconciliationPrisma = Pick<PrismaClient, 'payment'>;

/**
 * Financial reconciliation service.
 * Finds stale payments and schedules the existing idempotent settlement worker.
 * It never mutates financial state and never authorizes a blind payout resubmission.
 */
export class ReconciliationService {
  private running = false;

  constructor(
    private readonly prisma: ReconciliationPrisma,
    private readonly enqueue: SettlementEnqueuer = async (paymentId, brlCents) => {
      // Load BullMQ only when the production queue is actually used. Unit tests can
      // inject an in-memory enqueuer without opening Redis connections on import.
      const { enqueueSettlement } = await import('../queues/producers.js');
      await enqueueSettlement(paymentId, brlCents);
    },
  ) {}

  /**
   * Reconcile one bounded-by-query snapshot per cycle.
   * Local single-flight prevents overlapping setInterval executions in this process.
   * Database OR conditions return each payment once even when both payout legs are stale.
   */
  async reconcile(): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 min
      const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 min
      const partialTransferStatuses: TransferStatus[] = [
        TransferStatus.CREATED,
        TransferStatus.SUBMITTED,
        TransferStatus.PROCESSING,
      ];

      const candidates = await this.prisma.payment.findMany({
        where: {
          OR: [
            // PIX confirmed but conversion/ledger work did not start.
            { status: PaymentStatus.PIX_CONFIRMED, updatedAt: { lt: staleThreshold } },
            {
              status: { in: [PaymentStatus.CONVERSION_PENDING, PaymentStatus.CRYPTO_CREDITED] },
              updatedAt: { lt: staleThreshold },
            },

            // Provider acknowledged a payout but it has remained in progress.
            { merchantTransferStatus: TransferStatus.PROCESSING, updatedAt: { lt: stuckThreshold } },
            { platformTransferStatus: TransferStatus.PROCESSING, updatedAt: { lt: stuckThreshold } },

            // One beneficiary completed while the other leg remains unfinished.
            {
              merchantTransferStatus: TransferStatus.COMPLETED,
              platformTransferStatus: { in: partialTransferStatuses },
              updatedAt: { lt: staleThreshold },
            },
            {
              platformTransferStatus: TransferStatus.COMPLETED,
              merchantTransferStatus: { in: partialTransferStatuses },
              updatedAt: { lt: staleThreshold },
            },

            // A SUBMITTED payout has an ambiguous outcome. Re-entering the orchestrator
            // makes it query the provider using the original reference/idempotency key.
            // The orchestrator must resolve the old attempt before any new submission.
            { merchantTransferStatus: TransferStatus.SUBMITTED, updatedAt: { lt: stuckThreshold } },
            { platformTransferStatus: TransferStatus.SUBMITTED, updatedAt: { lt: stuckThreshold } },
          ],
        },
        select: { id: true, amountBrlCents: true },
        orderBy: { updatedAt: 'asc' },
      });

      let recovered = 0;
      const enqueued = new Set<string>();
      for (const payment of candidates) {
        // Defensive deduplication protects the queue if the query is later expanded.
        if (enqueued.has(payment.id)) continue;
        await this.enqueue(payment.id, payment.amountBrlCents);
        enqueued.add(payment.id);
        recovered++;
      }

      return recovered;
    } finally {
      this.running = false;
    }
  }
}
