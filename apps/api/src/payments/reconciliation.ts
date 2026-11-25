import { Prisma, PrismaClient, PaymentStatus, TransferStatus } from '@prisma/client';
import { enqueueSettlement } from '../queues/producers.js';

const DEFAULT_BATCH_SIZE = 100;
const STALE_AFTER_MS = 5 * 60 * 1000;
const PROCESSING_AFTER_MS = 30 * 60 * 1000;

type ReconciliationPayment = {
  id: string;
  amountBrlCents: bigint;
};

type ReconciliationDatabase = Pick<PrismaClient, 'payment'>;
type SettlementEnqueuer = (paymentId: string, brlCents: bigint) => Promise<void>;

/**
 * Financial reconciliation service.
 * Finds stale payments in one deduplicated query and schedules safe reprocessing.
 * It never changes financial state or submits payouts directly.
 */
export class ReconciliationService {
  private inFlight: Promise<number> | null = null;

  constructor(
    private readonly prisma: ReconciliationDatabase,
    private readonly enqueue: SettlementEnqueuer = enqueueSettlement,
    private readonly now: () => Date = () => new Date(),
    private readonly batchSize = DEFAULT_BATCH_SIZE,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new Error('reconciliation_batch_size_must_be_between_1_and_1000');
    }
  }

  /**
   * Main reconciliation loop. The server schedules this every five minutes.
   * Overlapping timer ticks in the same process share the active run.
   * Returns the number of unique payments successfully enqueued.
   */
  reconcile(): Promise<number> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.runReconciliation().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runReconciliation(): Promise<number> {
    const now = this.now().getTime();
    const staleThreshold = new Date(now - STALE_AFTER_MS);
    const stuckThreshold = new Date(now - PROCESSING_AFTER_MS);
    const pendingLegStatuses: TransferStatus[] = [
      TransferStatus.CREATED,
      TransferStatus.SUBMITTED,
      TransferStatus.PROCESSING,
    ];

    // A single OR query returns each Payment row once even if it matches
    // multiple recovery conditions (e.g. both payout legs are PROCESSING).
    const where: Prisma.PaymentWhereInput = {
      OR: [
        {
          status: {
            in: [
              PaymentStatus.PIX_CONFIRMED,
              PaymentStatus.CONVERSION_PENDING,
              PaymentStatus.CRYPTO_CREDITED,
            ],
          },
          updatedAt: { lt: staleThreshold },
        },
        {
          merchantTransferStatus: TransferStatus.PROCESSING,
          updatedAt: { lt: stuckThreshold },
        },
        {
          platformTransferStatus: TransferStatus.PROCESSING,
          updatedAt: { lt: stuckThreshold },
        },
        {
          merchantTransferStatus: TransferStatus.COMPLETED,
          platformTransferStatus: { in: pendingLegStatuses },
          updatedAt: { lt: staleThreshold },
        },
        {
          platformTransferStatus: TransferStatus.COMPLETED,
          merchantTransferStatus: { in: pendingLegStatuses },
          updatedAt: { lt: staleThreshold },
        },
      ],
    };

    let recovered = 0;
    let cursorId: string | undefined;

    // Keyset pagination keeps memory bounded while allowing one reconciliation
    // cycle to walk every matching payment. Ordering by immutable unique ID keeps
    // the cursor stable while workers update payment.updatedAt during the scan.
    while (true) {
      const batch = await this.prisma.payment.findMany({
        where,
        select: { id: true, amountBrlCents: true },
        orderBy: { id: 'asc' },
        take: this.batchSize,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      }) as ReconciliationPayment[];

      if (batch.length === 0) break;

      for (const payment of batch) {
        await this.enqueue(payment.id, payment.amountBrlCents);
        recovered++;
      }

      const lastPayment = batch.at(-1);
      if (!lastPayment) break;
      cursorId = lastPayment.id;
      if (batch.length < this.batchSize) break;
    }

    return recovered;
  }
}
