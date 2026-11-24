# PixSplit Architecture

## Overview
PixSplit is a B2B payment platform that enables merchants to receive PIX payments in Brazil and automatically settle 98% of the value as USDT to their external wallets, while 2% is routed to the platform owner's wallet as commission.

## System Components

### Backend (Fastify + TypeScript)
- **API Server** (`apps/api/src/server.ts`): Main HTTP server with JWT/HMAC auth, rate limiting, and webhook handling.
- **Payment Orchestrator** (`apps/api/src/payments/orchestrator.ts`): Idempotent state machine managing the 98/2 split logic using BigInt arithmetic.
- **Foxbit Adapter** (`apps/api/src/providers/foxbit/`): Integration layer for Fiat Gateway (PIX receipt) and external withdrawals (USDT).
- **Queue Workers** (`apps/api/src/queues/`): BullMQ-based async processing for settlements and retries.
- **Security Layer** (`apps/api/src/security/`): AES-256-GCM for PII encryption, HMAC-SHA256 for merchant API auth.

### Frontend (Next.js 16 App Router)
- **Checkout Page** (`/checkout/[externalId]`): Public-facing payment screen with QR code, polling, and countdown.
- **Merchant Panel** (`/merchant`): Dashboard, wallet management, API keys, transaction history, CSV export.
- **Admin Panel** (`/admin`): Global oversight, merchant management, reconciliation, audit logs.

### Infrastructure
- **PostgreSQL**: Primary data store via Prisma ORM.
- **Redis**: Queue backend for BullMQ workers.
- **Docker Compose**: Local development and test environments.

## Financial Flow
1. Merchant creates charge via API or dashboard.
2. Customer pays PIX → Foxbit Fiat Gateway confirms receipt.
3. Webhook triggers `PaymentOrchestrator.handlePixConfirmed`.
4. Orchestrator calculates split (BigInt, floor rounding):
   - `merchantNet = gross * 9800 / 10000`
   - `platformFee = gross - merchantNet`
5. Two independent withdrawal orders are created:
   - Merchant leg: USDT to merchant's external wallet.
   - Platform leg: USDT to platform owner's wallet.
6. Each leg has independent status tracking (`merchantTransferStatus`, `platformTransferStatus`).
7. Reconciliation service recovers partial failures or timeouts.

## Key Design Decisions
- **No Float Arithmetic**: All monetary values use BigInt (cents/satoshis) or Prisma Decimal with scale 6.
- **Independent Legs**: Merchant and platform transfers can succeed/fail independently; no atomic cross-leg rollback.
- **Idempotency**: Every operation keyed by `idempotencyKey`; duplicate webhooks safely ignored.
- **Raw Body HMAC**: Webhook signature verified against raw request buffer, not parsed JSON.
- **Secure Seed**: Production seed requires explicit env vars; refuses weak passwords.

## Data Models (Prisma)
- `Payment`: Core transaction record with split amounts, statuses, and provider references.
- `Transfer`: Individual withdrawal leg (merchant or platform) with provider SN and status.
- `LedgerEntry`: Immutable financial audit trail.
- `MerchantApiKey`: HMAC credentials with scoped permissions.
- `WalletDestination`: Encrypted external wallet addresses per merchant.
- `AuditEvent`: System-wide action logging.