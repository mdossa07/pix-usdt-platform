-- Baseline schema before provider webhook claim leases.
-- Keep this migration immutable; incremental changes belong in later migrations.

CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MERCHANT');
CREATE TYPE "MerchantType" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "WalletType" AS ENUM ('HOSTED', 'SELF_HOSTED');
CREATE TYPE "WalletOwner" AS ENUM ('SELF', 'THIRD_PARTY');
CREATE TYPE "WalletStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'DISABLED');
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PIX_PENDING', 'PIX_CONFIRMED', 'CONVERSION_PENDING', 'CRYPTO_CREDITED', 'COMMISSION_TRANSFER_PENDING', 'MERCHANT_PAYOUT_PENDING', 'PLATFORM_PAYOUT_PENDING', 'COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED', 'UNDER_REVIEW');
CREATE TYPE "TransferKind" AS ENUM ('MERCHANT_PAYOUT', 'PLATFORM_COMMISSION');
CREATE TYPE "TransferStatus" AS ENUM ('CREATED', 'SUBMITTED', 'PENDING_TRAVEL_RULE', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "LedgerStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'MERCHANT',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Merchant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "merchantType" "MerchantType" NOT NULL,
  "legalName" TEXT NOT NULL,
  "taxIdEncrypted" TEXT NOT NULL,
  "taxIdLast4" TEXT NOT NULL,
  "phoneEncrypted" TEXT,
  "foxbitSubMemberSn" TEXT,
  "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WalletDestination" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "exchangeName" TEXT NOT NULL,
  "networkCode" TEXT NOT NULL,
  "currencySymbol" TEXT NOT NULL DEFAULT 'usdt',
  "addressEncrypted" TEXT NOT NULL,
  "addressLast8" TEXT NOT NULL,
  "tagEncrypted" TEXT,
  "walletType" "WalletType" NOT NULL DEFAULT 'HOSTED',
  "walletOwner" "WalletOwner" NOT NULL DEFAULT 'SELF',
  "status" "WalletStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "holderName" TEXT NOT NULL,
  "holderTaxIdEncrypted" TEXT,
  "holderCountry" TEXT NOT NULL DEFAULT 'BR',
  "vaspEntityCountry" TEXT,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletDestination_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformWallet" (
  "id" TEXT NOT NULL,
  "networkCode" TEXT NOT NULL,
  "currencySymbol" TEXT NOT NULL DEFAULT 'usdt',
  "addressEncrypted" TEXT NOT NULL,
  "addressLast8" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformWallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "walletDestinationId" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "description" TEXT,
  "amountBrlCents" BIGINT NOT NULL,
  "quoteId" TEXT,
  "fxRate" DECIMAL(28,12),
  "providerGrossUsdt" DECIMAL(28,8),
  "providerFeesUsdt" DECIMAL(28,8),
  "commissionBps" INTEGER NOT NULL DEFAULT 200,
  "commissionUsdt" DECIMAL(28,8),
  "merchantNetUsdt" DECIMAL(28,8),
  "providerOrderId" TEXT,
  "providerTransactionId" TEXT,
  "pixCopyPaste" TEXT,
  "payerName" TEXT,
  "payerTaxIdEncrypted" TEXT,
  "payerTaxIdLast4" TEXT,
  "payerEmailEncrypted" TEXT,
  "payerPhoneEncrypted" TEXT,
  "payerEndToEndId" TEXT,
  "pixQrCodeBase64" TEXT,
  "expiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "merchantTransferStatus" "TransferStatus",
  "platformTransferStatus" "TransferStatus",
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Transfer" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "kind" "TransferKind" NOT NULL,
  "status" "TransferStatus" NOT NULL DEFAULT 'CREATED',
  "amountUsdt" DECIMAL(28,8) NOT NULL,
  "networkCode" TEXT NOT NULL,
  "destinationAddressEnc" TEXT NOT NULL,
  "providerWithdrawalSn" TEXT,
  "txHash" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MerchantApiKey" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "signingSecretEncrypted" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT,
  "eventType" TEXT NOT NULL,
  "payloadEncrypted" TEXT NOT NULL,
  "signatureValid" BOOLEAN NOT NULL,
  "processedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "accountCode" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amount" DECIMAL(28,8) NOT NULL,
  "status" "LedgerStatus" NOT NULL DEFAULT 'PENDING',
  "reference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "ipAddress" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Merchant_userId_key" ON "Merchant"("userId");
CREATE UNIQUE INDEX "Merchant_foxbitSubMemberSn_key" ON "Merchant"("foxbitSubMemberSn");
CREATE INDEX "WalletDestination_merchantId_isDefault_idx" ON "WalletDestination"("merchantId", "isDefault");
CREATE INDEX "WalletDestination_merchantId_status_idx" ON "WalletDestination"("merchantId", "status");
CREATE UNIQUE INDEX "PlatformWallet_networkCode_key" ON "PlatformWallet"("networkCode");
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");
CREATE INDEX "Payment_merchantId_createdAt_idx" ON "Payment"("merchantId", "createdAt");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
CREATE UNIQUE INDEX "Transfer_providerWithdrawalSn_key" ON "Transfer"("providerWithdrawalSn");
CREATE UNIQUE INDEX "Transfer_idempotencyKey_key" ON "Transfer"("idempotencyKey");
CREATE INDEX "Transfer_paymentId_kind_idx" ON "Transfer"("paymentId", "kind");
CREATE INDEX "Transfer_status_createdAt_idx" ON "Transfer"("status", "createdAt");
CREATE UNIQUE INDEX "MerchantApiKey_keyHash_key" ON "MerchantApiKey"("keyHash");
CREATE INDEX "MerchantApiKey_merchantId_revokedAt_idx" ON "MerchantApiKey"("merchantId", "revokedAt");
CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");
CREATE INDEX "WebhookEvent_provider_eventType_receivedAt_idx" ON "WebhookEvent"("provider", "eventType", "receivedAt");
CREATE UNIQUE INDEX "LedgerEntry_reference_key" ON "LedgerEntry"("reference");
CREATE INDEX "LedgerEntry_paymentId_accountCode_idx" ON "LedgerEntry"("paymentId", "accountCode");
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletDestination" ADD CONSTRAINT "WalletDestination_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_walletDestinationId_fkey" FOREIGN KEY ("walletDestinationId") REFERENCES "WalletDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
