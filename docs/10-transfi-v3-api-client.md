# TransFi v3 API client

## Scope

The API client in `apps/api/src/providers/transfi/transfi-client.ts` implements the documented v3 request patterns for:

- HTTP Basic authentication and mandatory `MID` header.
- Dynamic sender fields and individual/business sender creation.
- Dynamic recipient fields and individual/business recipient creation.
- Payment-method discovery for deposit and withdrawal directions.
- Order creation, order lookup, paginated order listing and balance lookup.
- Standard KYC/KYB hosted flows and role-level account verification status.

The client is deliberately not wired into the active `PaymentProvider` flow. `TransFiAdapter` remains mock-only and rejects construction in `sandbox` or `live` mode until commercial approval and end-to-end certification are complete.

## API version and authentication

Use the v3 base URL:

- Sandbox: `https://sandbox-api.transfi.com`
- Production: `https://api.transfi.com`

All requests use HTTP Basic authentication and a `MID` header. A merchant or sub-merchant MID scopes every request. The client rejects unsupported hosts, missing credentials and missing MID before it sends network traffic.

The v3 client does not send a generic `Idempotency-Key` header. Order de-duplication uses `partnerId` in the JSON body.

## Dynamic sender and recipient onboarding

Never hard-code country-specific form fields.

### Sender

1. Call `POST /v3/senders/mandatory-fields` with `type` (`individual` or `organization`), `geo` (two-letter ISO country code) and `currencyType` (`fiat` or `crypto`).
2. Build the form from the provider's `inputs` response, including its validation rules.
3. Create the user with `POST /v3/senders/individual` or `POST /v3/senders/business`.
4. Persist the returned `userId`; subsequent v3 KYC and order requests use this ID, not email.

### Recipient

1. Call `POST /v3/recipients/mandatory-fields` with `type`, `geo` and `currencyType`.
2. Build the form from the returned `inputs`.
3. Create the recipient with `POST /v3/recipients/individual` or `POST /v3/recipients/business`.
4. Persist the returned `userId` and use it in payout orders.

If a sender or recipient already exists, use the provider's existing `userId` response; do not create a duplicate profile.

## Payment-method discovery

Call `GET /v3/config/payment-methods` before creating an order:

- `direction=deposit` for incoming collections such as PIX.
- `direction=withdraw` for outgoing bank or wallet payouts.
- Filter by country/currency and account type where supported.
- Use `headlessMode=true` when the platform is building the payment step itself.

Use the returned `paymentType`, `paymentCode` and required details. Do not hard-code a PIX method code or assume BRL/PIX is enabled for a particular MID.

## Orders and idempotency

Create payin and payout orders through `POST /v3/orders`.

Each order body must include a unique `partnerId`, `orderType`, `purposeCode`, `source` and `destination`; customer orders also require the correct provider `userId`. The amount is placed on exactly one side:

- Payin: amount and payment method in `source`; the destination identifies the currency to be credited.
- Payout: amount on the recipient side in `destination`; use the payment method or crypto network accepted for that recipient.

For this platform, each economic leg must have its own stable `partnerId` (merchant payout and platform commission payout are separate orders). Persist each partner ID before sending the request.

- Repeating the same `partnerId` is not a retry strategy. On a duplicate response or an unknown network outcome, recover the original order before deciding what to do.
- Use `GET /v3/orders/{orderId}` when the order ID is known.
- Use paginated `GET /v3/orders` for reconciliation and missed-webhook recovery; continue while `pagination.hasNext` is true.
- Do not blindly resubmit an order after a timeout.
- After a final failed order, correct the cause and use a new `partnerId` for a new order.

The client does not automatically retry mutations.

## KYC and KYB

- Start hosted individual verification with `POST /v3/kyc/standard` using the provider `userId`.
- Start hosted business verification with `POST /v3/kyb/standard` and `uiEnabled: true` to request a hosted link.
- Read `GET /v3/kyc/account-status` or `GET /v3/kyb/account-status` by `userId` and role (`sender`, `recipient` or `both`).

A single provider user may have separate sender and recipient verification states. Check the role used by the order; an account-wide “approved” label is not sufficient.

## Status handling

For incoming collection orders, wait for `fund_settled` before treating the payin as received. `initiated`, `fund_processing` and manual review states are not successful receipt.

For crypto payouts, wait for `asset_settled`. For fiat payouts, `fund_settled` is the final success. Treat `fund_failed`, `fund_deposit_failed` and `asset_settle_failed` as terminal failures according to order type. Intermediate states remain pending.

Webhooks are the primary signal; order lookup/listing is the recovery and reconciliation path.

## Current blockers

- The selected provider/MID still needs written approval for third-party PIX collection and the platform's exact merchant/recipient structure.
- Confirm that the configured MID supports BRL deposits through PIX and that the returned method code is enabled for the intended payer type.
- Confirm sender onboarding requirements for the end payer. TransFi v3 payin orders are associated with a registered `userId`; do not assume the payer can remain anonymous.
- Confirm separate crypto payout support for merchant and platform beneficiaries, including both account roles, wallet networks, limits, fees, Travel Rule and balance prefunding.
- Obtain sandbox credentials, MIDs, webhook secrets and the permitted corridors.
- Complete sandbox tests for payin, two independent payouts, partial failures, duplicate partner IDs, missed webhooks, reconciliation and refunds.

Until every blocker is resolved, `PAYMENTS_MODE` remains `mock`, the TransFi adapter remains fail-closed, and no real PIX, conversion or payout is sent.
