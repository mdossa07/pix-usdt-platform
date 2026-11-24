ALTER TABLE "User"
  ADD COLUMN "twoFactorSecretEncrypted" TEXT,
  ADD COLUMN "twoFactorPendingSecretEncrypted" TEXT,
  ADD COLUMN "twoFactorEnabledAt" TIMESTAMP(3);
