CREATE TYPE "MerchantWebhookDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

CREATE TABLE "MerchantWebhookEndpoint" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "events" TEXT[] NOT NULL,
  "signingSecretEncrypted" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MerchantWebhookDelivery" (
  "id" TEXT NOT NULL,
  "endpointId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "MerchantWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "responseStatus" INTEGER,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MerchantWebhookEndpoint_merchantId_isEnabled_idx"
  ON "MerchantWebhookEndpoint"("merchantId", "isEnabled");
CREATE UNIQUE INDEX "MerchantWebhookDelivery_endpointId_eventId_key"
  ON "MerchantWebhookDelivery"("endpointId", "eventId");
CREATE INDEX "MerchantWebhookDelivery_status_nextAttemptAt_lockedAt_idx"
  ON "MerchantWebhookDelivery"("status", "nextAttemptAt", "lockedAt");
CREATE INDEX "MerchantWebhookDelivery_endpointId_createdAt_idx"
  ON "MerchantWebhookDelivery"("endpointId", "createdAt");

ALTER TABLE "MerchantWebhookEndpoint"
  ADD CONSTRAINT "MerchantWebhookEndpoint_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MerchantWebhookDelivery"
  ADD CONSTRAINT "MerchantWebhookDelivery_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "MerchantWebhookEndpoint"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
