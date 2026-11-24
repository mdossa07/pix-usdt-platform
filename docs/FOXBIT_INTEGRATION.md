# Foxbit Integration Guide

## Overview
PixSplit integrates with Foxbit via the **Partner API v3** and **Fiat Gateway** product. The integration follows a two-step settlement model: PIX receipt is centralized in the partner account, then two independent external withdrawals are executed.

## Authentication
- **API Key + Secret**: Used for all REST calls. Stored encrypted in `.env`.
- **Webhook Signature**: `X-FB-SIGNATURE` header contains HMAC-SHA256 of raw request body using webhook secret. Verified in constant-time to prevent timing attacks.

## Fiat Gateway Flow
1. **Create Charge**: `POST /v3/partners/fiat-gateway/charges` with BRL amount and callback URL.
2. **Customer Pays PIX**: Foxbit receives payment in partner's custodial account.
3. **Webhook Notification**: `PIX_RECEIVED` event sent to our `/webhooks/foxbit` endpoint.
4. **Conversion**: Partner converts BRL → USDT internally (not automatic; requires explicit order or balance).
5. **External Withdrawals**: Two separate `POST /v3/partners/withdrawals` calls:
   - Merchant leg (98%): External USDT wallet address + network + memo/tag.
   - Platform leg (2%): Platform owner's external USDT wallet.

## Critical Constraints
- **No Automatic Split**: Fiat Gateway does NOT split incoming PIX to sub-accounts. All funds land in partner account first.
- **Two Independent Transfers**: Each withdrawal is a separate API call with its own status, SN, and failure mode.
- **Travel Rule**: Withdrawals above threshold require beneficiary declaration (name, tax ID, wallet ownership proof).
- **Idempotency**: All withdrawal requests must include `idempotency_key` to prevent duplicate transfers on retry.
- **Network Matching**: Wallet destination must specify correct network code (e.g., `TRC20`, `ERC20`, `BEP20`). Mismatch causes loss of funds.

## Webhook Handling
- **Raw Body Verification**: Signature computed over exact bytes received, not parsed JSON.
- **Replay Protection**: Timestamp validation (±5 min skew) + idempotency key deduplication.
- **Event Types**: Only `PIX_RECEIVED` and `WITHDRAWAL_COMPLETED`/`WITHDRAWAL_FAILED` trigger state changes.
- **Unknown Fields**: Ignored gracefully; schema evolution safe.

## Error Recovery
- **Timeout on Withdrawal**: Orchestrator queries `GET /v3/partners/withdrawals/:sn` to check remote status before marking FAILED.
- **Partial Success**: If merchant leg succeeds but platform fails (or vice versa), each leg retains independent status. Reconciliation service retries failed leg only.
- **Provider Downtime**: BullMQ retry queue with exponential backoff (max 10 attempts). Dead-lettered jobs flagged in admin panel.

## Sandbox vs Production
- **Sandbox**: Requires explicit enablement by Foxbit account manager. Uses testnet wallets and mock PIX.
- **Production Credentials**: Never committed to repo. Loaded from env vars or vault.
- **Permission Scope**: Partner API requires special permissions for external withdrawals and fiat gateway. Verify with Foxbit before deploying.

## Compliance Notes
- **KYC**: Merchants must complete KYC before enabling withdrawals. Status tracked in `Merchant.kycStatus`.
- **Audit Trail**: Every withdrawal creates immutable `LedgerEntry` with provider SN, amounts, and timestamps.
- **Rate Limits**: Respect Foxbit rate limits (documented in Partner API docs). Our rate limiter prevents burst violations.