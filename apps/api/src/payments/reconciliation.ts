import { PrismaClient, PaymentStatus, TransferStatus } from '@prisma/client';

type SettlementEnqueuer = (paymentId: string, brlCents: bigint) => Promise<void>;
type ReconciliationPrisma = Pick<PrismaClient, '$transaction'>;

const RECONCILIATION_ADVISORY_LOCK_ID = 726953801;
const RECONCILIATION_BATCH_SIZE = 25;

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
   * Reconcile one bounded snapshot per cycle.
   * Local single-flight avoids overlapping timers in the same process.
   * A transaction-scoped PostgreSQL advisory lock coordinates separate API replicas.
   * The bounded batch keeps the lock/transaction short under reconciliation backlog.
   */
  async reconcile(): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${RECONCILIATION_ADVISORY_LOCK_ID}::bigint) AS acquired
        `;
        if (!lockRows[0]?.acquired) return 0;

        const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 min
        const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 min
        const partialTransferStatuses: TransferStatus[] = [
          TransferStatus.CREATED,
          TransferStatus.SUBMITTED,
          TransferStatus.PROCESSING,
        ];

        const candidates = await tx.payment.findMany({
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
          take: RECONCILIATION_BATCH_SIZE,
        });

        const uniqueCandidates = [...new Map(candidates.map(payment => [payment.id, payment])).values()];
        // Wait for every enqueue to settle before releasing the transaction-scoped
        // lock. If any enqueue fails, the next cycle can safely retry the batch;
        // BullMQ job IDs and the orchestrator's database claims remain idempotent.
        const results = await Promise.allSettled(
          uniqueCandidates.map(payment => this.enqueue(payment.id, payment.amountBrlCents)),
        );
        const failed = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (failed) throw failed.reason;

        return uniqueCandidates.length;
      }, { maxWait: 5_000, timeout: 30_000 });
    } finally {
      this.running = false;
    }
  }
}
