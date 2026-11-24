ALTER TABLE "User"
  ADD COLUMN "twoFactorSecretEncrypted" TEXT,
  ADD COLUMN "twoFactorPendingSecretEncrypted" TEXT,
  ADD COLUMN "twoFactorEnabledAt" TIMESTAMP(3),
  ADD COLUMN "twoFactorLastUsedStep" BIGINT;

CREATE TABLE "UserTwoFactorRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTwoFactorRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserTwoFactorRecoveryCode_codeHash_key"
  ON "UserTwoFactorRecoveryCode"("codeHash");
CREATE INDEX "UserTwoFactorRecoveryCode_userId_usedAt_idx"
  ON "UserTwoFactorRecoveryCode"("userId", "usedAt");

ALTER TABLE "UserTwoFactorRecoveryCode"
  ADD CONSTRAINT "UserTwoFactorRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
