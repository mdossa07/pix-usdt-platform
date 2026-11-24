# Deploy & Security Guide

## Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (for local/test)
- Foxbit Partner API credentials (sandbox or production)

## Environment Variables
Copy `.env.example` to `.env` and fill all required values:
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/pixsplit
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random-256-bit-hex>
PII_ENCRYPTION_KEY=<random-256-bit-hex>
FOXBIT_API_KEY=<from-foxbit-dashboard>
FOXBIT_API_SECRET=<from-foxbit-dashboard>
FOXBIT_WEBHOOK_SECRET=<from-foxbit-dashboard>
PAYMENT_PROVIDER_MODE=mock|foxbit  # NEVER use 'mock' in production
ADMIN_PASSWORD=<strong-password>
MERCHANT_PASSWORD=<strong-password>
SEED_ALLOW_PRODUCTION=false  # Set true ONLY for initial prod setup
```

## Local Development
```bash
docker compose up -d          # Start Postgres + Redis
pnpm install                  # Install dependencies
pnpm db:migrate               # Apply schema migrations
pnpm db:seed                  # Seed test data (dev only)
pnpm dev                      # Start API + Web in watch mode
```

## Production Deploy
1. **Build**: `pnpm build`
2. **Migrate**: `pnpm db:migrate` (against production DB)
3. **Seed** (first time only): `SEED_ALLOW_PRODUCTION=true pnpm db:seed`
4. **Start**: Use PM2/Docker/systemd to run `apps/api/dist/server.js` and `apps/web/.next/standalone`
5. **HTTPS**: Terminate TLS at reverse proxy (nginx/Caddy/Cloudflare)
6. **Health Checks**: `GET /health` returns 200 when DB/Redis are connected

## Security Hardening
- **PII Encryption**: All sensitive fields (wallet addresses, tax IDs) encrypted with AES-256-GCM before storage.
- **HMAC Auth**: Merchant API requests signed with HMAC-SHA256; timestamp validation prevents replay.
- **Webhook Signature**: Verified against raw body using constant-time comparison.
- **Rate Limiting**: IP-based on public routes; identity-based on authenticated routes.
- **CORS**: Restricted to known frontend origins in production.
- **Secrets**: Never logged, never returned in API responses, never committed to git.
- **RBAC**: Admin endpoints require `SUPER_ADMIN` role; merchant endpoints scoped to own merchant ID.
- **Audit Trail**: All state-changing operations logged to `AuditEvent` table.

## Monitoring & Alerts
- **Queue Health**: Monitor BullMQ queue depth and worker concurrency via Redis.
- **Failed Jobs**: Dead-lettered settlements appear in admin panel under "Reconciliation".
- **Provider Status**: Foxbit API latency/error rate tracked in logs; alert if >5% failure over 5min.
- **Database**: Connection pool saturation and slow query logging enabled.

## Backup Strategy
- **PostgreSQL**: Daily pg_dump + WAL archiving to S3/GCS.
- **Redis**: RDB snapshots every hour; AOF disabled (queues are transient).
- **Secrets**: Stored in vault (HashiCorp/AWS Secrets Manager); rotated quarterly.

## Known Limitations
- **No Real Money Testing**: Sandbox uses mock PIX and testnet wallets. Production requires Foxbit approval.
- **Travel Rule**: Not yet automated; manual declaration required for large withdrawals.
- **Multi-currency**: Only BRL→USDT supported currently.
- **Webhook Retries**: Foxbit retries webhooks up to 3 times; our idempotency handles duplicates safely.