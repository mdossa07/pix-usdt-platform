ALTER TABLE "IdempotencyRecord"
  ADD COLUMN "merchantId" TEXT,
  ADD COLUMN "amountBrlCents" BIGINT,
  ADD COLUMN "walletDestinationId" TEXT,
  ADD COLUMN "lastReviewedAt" TIMESTAMP(3),
  ADD COLUMN "lastReviewedByUserId" TEXT,
  ADD COLUMN "reviewNote" TEXT;

CREATE INDEX "IdempotencyRecord_scope_createdAt_idx"
  ON "IdempotencyRecord"("scope", "createdAt");

CREATE INDEX "IdempotencyRecord_merchantId_createdAt_idx"
  ON "IdempotencyRecord"("merchantId", "createdAt");
