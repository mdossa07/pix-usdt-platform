CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSession_jti_key" ON "AuthSession"("jti");
CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx"
  ON "AuthSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
