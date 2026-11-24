ALTER TABLE "WebhookEvent"
  ADD COLUMN IF NOT EXISTS "payloadHash" TEXT,
  ADD COLUMN IF NOT EXISTS "processingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processingToken" TEXT;

CREATE INDEX IF NOT EXISTS "WebhookEvent_processedAt_processingAt_idx"
  ON "WebhookEvent" ("processedAt", "processingAt");
