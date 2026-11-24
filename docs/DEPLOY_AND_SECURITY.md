# Deploy & Security Guide

## Prerequisites
- Node.js 22+
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (for local/test)
- Provider sandbox and production credentials only after written approval

## Environment Variables
Copy `.env.example` to `.env` and fill all required values:
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/pixsplit
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random-256-bit-hex>
PII_ENCRYPTION_KEY=<random-256-bit-hex>
FOXBIT_API_KEY=<from-provider-dashboard>
FOXBIT_API_SECRET=<from-provider-dashboard>
FOXBIT_WEBHOOK_SECRET=<from-provider-dashboard>
PAYMENTS_MODE=mock|sandbox|live
ADMIN_PASSWORD=<strong-password>
MERCHANT_PASSWORD=<strong-password>
SEED_ALLOW_PRODUCTION=false
```

## Local Development
```bash
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed
pnpm dev
```

## Database migration policy

- `pnpm db:migrate:dev` is for local development only; it may create new migration files.
- `pnpm db:migrate` runs `prisma migrate deploy` and is the safe migration command for CI/staging/production.
- Never run `prisma db push` against production.
- The CI verifies all committed migrations against an empty PostgreSQL schema.

### Existing database created before migration history

The initial migration is `20261124000000_initial_schema`. For an existing database that already has the exact schema represented by that baseline (before webhook claim lease columns), take a verified backup and compare the live schema first. Then mark only the baseline as applied and deploy subsequent migrations:

```bash
pnpm --filter @pixsplit/api exec prisma migrate resolve --applied 20261124000000_initial_schema --schema prisma/schema.prisma
pnpm db:migrate
```

Do not mark the baseline as applied on an empty database. A fresh database must run `pnpm db:migrate` so the initial schema and every later migration are actually created. If the existing schema differs from the baseline, stop and create a reviewed data-preserving migration plan instead of forcing resolution.

## Production Deploy
1. Back up PostgreSQL and verify that the backup can be restored.
2. Set secrets through the deployment secret manager, not a committed `.env`.
3. Run `pnpm build`.
4. Run `pnpm db:migrate` against the target database.
5. Start API and web services behind HTTPS.
6. Verify readiness, queue connectivity, database connectivity and provider webhook signatures.
7. Keep real-money endpoints disabled until provider, compliance and end-to-end certification are complete.

## Security Hardening
- **PII Encryption**: Sensitive wallet addresses and tax identifiers are encrypted with AES-256-GCM.
- **HMAC Auth**: Merchant API requests use encrypted signing secrets, a separate database verifier, timestamp validation and a cryptographically random nonce consumed atomically.
- **Webhook Signature**: Verified against raw body with constant-time comparison. Authenticated events are fingerprinted, atomically claimed with a recoverable PostgreSQL lease, and completed only after successful processing.
- **Replay Protection**: Repeated merchant API nonces are rejected.
- **Rate Limiting**: IP-based on public routes; identity-based on authenticated routes.
- **CORS**: Restrict production origins to the deployed application.
- **Secrets**: Never log or commit secrets. Back up `PII_ENCRYPTION_KEY` separately; losing it makes encrypted signing secrets and PII unrecoverable.
- **RBAC**: Administrative endpoints require the appropriate privileged role; merchant operations are scoped to the authenticated merchant.
- **Audit Trail**: State-changing operations are recorded in `AuditEvent`.

## Provider webhook recovery

Foxbit and TransFi events are keyed by provider plus provider event ID. The API stores a SHA-256 fingerprint of the authenticated raw payload and rejects a different body under an existing event ID. For legacy rows created before payload fingerprints existed, the service decrypts the stored original body, verifies an exact match and then backfills the fingerprint; unverifiable or mismatched rows fail closed. PostgreSQL leases prevent concurrent claims and can be reclaimed after 60 seconds. A worker with a replaced lease token cannot mark the newer claim complete. Unresolved events return HTTP 503 with `Retry-After`; confirm each provider's retry behavior in sandbox before production.

## Known Limitations
- No real PIX collection, BRL/USDT conversion or on-chain payout is enabled by this repository baseline.
- Foxbit and TransFi business operations still require exact provider contracts and sandbox certification.
- Travel Rule and compliance workflows require provider/legal validation.
- Production deployment remains blocked until a complete PIX → conversion → 98% merchant payout + 2% platform commission flow passes end-to-end certification.
