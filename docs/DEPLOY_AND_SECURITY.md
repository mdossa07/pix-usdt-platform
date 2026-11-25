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

## Railway deployment — monorepo compartilhado

A implantação usa dois serviços de aplicação no mesmo repositório: API e Web. Como ambos dependem do `pnpm-workspace.yaml`, `pnpm-lock.yaml` e manifests da raiz, mantenha o **Root Directory vazio (raiz do repositório)** nos dois serviços. Não configure `apps/api` ou `apps/web` como Root Directory: isso esconderia o lockfile e a configuração do workspace.

### Serviço API

Configure o serviço conectado ao repositório:

- Build command:
  ```bash
  pnpm install --frozen-lockfile && pnpm --filter @pixsplit/api db:generate:deploy && pnpm --filter @pixsplit/api build
  ```
- Pre-deploy command:
  ```bash
  pnpm db:migrate:deploy
  ```
- Start command:
  ```bash
  pnpm start:api
  ```
- Healthcheck path: `/ready`. A API usa a variável `PORT` injetada pela plataforma quando `API_PORT` não estiver configurada. O processo escuta em `0.0.0.0`.

### Serviço Web

Configure outro serviço ligado ao mesmo repositório e à raiz:

- Build command:
  ```bash
  pnpm install --frozen-lockfile && pnpm --filter @pixsplit/web build
  ```
- Start command:
  ```bash
  pnpm start:web
  ```
- A Web usa `PORT` injetado pela plataforma e escuta em `0.0.0.0`.
- Configure `NEXT_PUBLIC_API_URL` **antes do build**: o Next.js incorpora essa variável no bundle de produção. Depois de criar o domínio HTTPS da API, defina a URL e faça novo deploy da Web.

### Ordem de configuração e variáveis

1. Crie o ambiente de produção e os serviços gerenciados PostgreSQL e Redis. Use uma versão PostgreSQL compatível com o banco atual (PostgreSQL 16) até que o cutover 16→18 tenha backup/restore real ensaiado e aprovado. Use Redis 7.
2. Crie os serviços API e Web a partir do mesmo repositório; gere primeiro o domínio HTTPS da API e depois o domínio HTTPS da Web.
3. No serviço API, configure `NODE_ENV=production`, `PAYMENTS_MODE=mock`, `DATABASE_URL` e `REDIS_URL` referenciando os serviços gerenciados, `APP_URL` igual à origem HTTPS exata da Web (sem path), `JWT_SECRET` aleatório com pelo menos 32 caracteres e `PII_ENCRYPTION_KEY` aleatório de 32 bytes (64 caracteres hexadecimais). Opcionalmente configure `METRICS_BEARER_TOKEN` aleatório de 32–256 caracteres ASCII visíveis se Prometheus for utilizado.
4. No serviço Web, configure `NODE_ENV=production` e `NEXT_PUBLIC_API_URL` igual à URL base HTTPS pública da API.
5. Salve segredos somente no secret manager/variáveis privadas da plataforma. Não os coloque em GitHub, build args, logs ou documentação. Não configure `API_PORT` na produção, a menos que exista motivo operacional específico; o app usa `PORT` fornecido pela plataforma.
6. Faça o primeiro deploy da API. O pre-deploy executa `prisma migrate deploy`; depois confirme `/ready` HTTP 200. Faça o deploy da Web e confirme login, cookie HttpOnly, CSRF e logout em HTTPS.
7. Crie o primeiro superadministrador por sessão operacional controlada, com senha forte, e ative/valide TOTP antes de abrir o acesso administrativo.

### Políticas de segurança do deploy

- Não use `prisma db push` em produção. `db:migrate:deploy` aplica somente migrations versionadas.
- Não marque a migration baseline como aplicada em banco vazio.
- Não habilite pagamentos sandbox/live. A API rejeita qualquer `PAYMENTS_MODE` diferente de `mock` enquanto o gate de provedor/regulatório não for encerrado.
- O primeiro deploy não representa autorização para coletar PIX, converter BRL/USDT ou executar payouts.
- Antes de tráfego real, concluir backup/restore, firewall/rede privada, alertas, pentest, teste de carga, DR e piloto controlado.
- A infraestrutura Railway ainda precisa ser criada no workspace correto e o custo dos serviços gerenciados deve ser revisado antes do provisionamento. Este repositório não contém credenciais nem domínios de produção.
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

## Browser session security

- The browser never receives the authenticated JWT in JSON and never stores it in `localStorage`.
- Login, registration and successful TOTP verification issue a `pixsplit_session` cookie with `HttpOnly`, `Path=/`, a two-hour lifetime and `SameSite=Lax` in development. Production uses `SameSite=None; Secure` because the web and API origins may be separate.
- The cookie is host-only for the API host. The web client must call the API with `credentials: 'include'`; the API must allow only the configured `APP_URL` origin with credentials.
- The signed session JWT contains a random CSRF token claim. Authenticated browser writes require the matching `x-csrf-token` header and an `Origin` exactly matching the configured application origin. The token is returned separately from the JWT and held in `sessionStorage`; it is not an authentication credential.
- `GET /v1/auth/csrf` lets a newly opened tab recover the same CSRF token from the signed session cookie without rotating the cookie and invalidating other tabs.
- Logout clears the browser cookie. The JWT expires after two hours, and every authenticated request rechecks that the user is active and still has the current database role.
- Legacy bearer JWT authorization remains accepted for compatibility. Merchant integrations should continue using HMAC API keys and nonce anti-replay, not browser cookies.
- Production must use HTTPS for both web and API origins. Configure `APP_URL` as the exact browser origin (scheme + host, without a path) and configure `NEXT_PUBLIC_API_URL` as the HTTPS API base URL.

## Provider webhook recovery

Foxbit and TransFi events are keyed by provider plus provider event ID. The API stores a SHA-256 fingerprint of the authenticated raw payload and rejects a different body under an existing event ID. For legacy rows created before payload fingerprints existed, the service decrypts the stored original body, verifies an exact match and then backfills the fingerprint; unverifiable or mismatched rows fail closed. PostgreSQL leases prevent concurrent claims and can be reclaimed after 60 seconds. A worker with a replaced lease token cannot mark the newer claim complete. Unresolved events return HTTP 503 with `Retry-After`; confirm each provider's retry behavior in sandbox before production.

## Known Limitations
- No real PIX collection, BRL/USDT conversion or on-chain payout is enabled by this repository baseline.
- Foxbit and TransFi business operations still require exact provider contracts and sandbox certification.
- Travel Rule and compliance workflows require provider/legal validation.
- Production deployment remains blocked until a complete PIX → conversion → 98% merchant payout + 2% platform commission flow passes end-to-end certification.
