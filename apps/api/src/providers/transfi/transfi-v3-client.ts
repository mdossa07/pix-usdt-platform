export type TransFiEntityType = 'individual' | 'business';
export type TransFiCurrencyType = 'fiat' | 'crypto';
export type TransFiPaymentDirection = 'deposit' | 'withdraw';
export type TransFiOrderType = 'payin' | 'payout';

export interface TransFiMandatoryFieldsRequest {
  country: string;
  type: TransFiEntityType;
  currencyType: TransFiCurrencyType;
}

export interface TransFiPaymentMethodsRequest {
  direction: TransFiPaymentDirection;
  country: string;
  currency?: string;
}

export interface TransFiOrderRequest {
  userId: string;
  orderType: TransFiOrderType;
  purposeCode: string;
  partnerId: string;
  source: Record<string, unknown>;
  destination: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TransFiClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  mid: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class TransFiApiError extends Error {
  readonly statusCode: number | null;
  readonly providerCode: string | null;
  readonly outcomeUnknown: boolean;

  constructor(input: {
    statusCode: number | null;
    providerCode: string | null;
    outcomeUnknown: boolean;
  }) {
    super(input.outcomeUnknown
      ? 'TransFi request outcome is unknown; reconcile by partnerId before retrying.'
      : 'TransFi API request failed.');
    this.name = 'TransFiApiError';
    this.statusCode = input.statusCode;
    this.providerCode = input.providerCode;
    this.outcomeUnknown = input.outcomeUnknown;
  }
}

function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`transfi_${name}_required`);
  return trimmed;
}

function safeProviderCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const value = record.errorCode ?? record.error_code ?? record.code;
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
}

/**
 * TransFi v3 transport.
 *
 * No automatic retries are performed. POST /v3/orders uses partnerId as the
 * provider-side idempotency reference; after timeout, callers must query and
 * reconcile that reference before deciding whether a new order is safe.
 */
export class TransFiV3Client {
  private readonly baseUrl: URL;
  private readonly username: string;
  private readonly password: string;
  private readonly mid: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TransFiClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    if (this.baseUrl.protocol !== 'https:') throw new Error('transfi_base_url_must_use_https');
    if (this.baseUrl.username || this.baseUrl.password) throw new Error('transfi_base_url_credentials_not_allowed');
    this.baseUrl.pathname = this.baseUrl.pathname.replace(/\/$/, '');
    this.username = requireText(options.username, 'username');
    this.password = requireText(options.password, 'password');
    this.mid = requireText(options.mid, 'mid');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 60_000) {
      throw new Error('transfi_timeout_out_of_range');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private endpoint(path: string): URL {
    if (!path.startsWith('/v3/')) throw new Error('transfi_v3_path_required');
    return new URL(path, this.baseUrl);
  }

  private async request<T>(
    path: string,
    input: { method: 'GET' | 'POST'; body?: Record<string, unknown> },
  ): Promise<T> {
    const url = this.endpoint(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64')}`,
      mid: this.mid,
    });
    let body: string | undefined;
    if (input.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(input.body);
    }

    try {
      const response = await this.fetchImpl(url, {
        method: input.method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
      });
      const raw = await response.text();
      let payload: unknown = null;
      if (raw) {
        try { payload = JSON.parse(raw) as unknown; }
        catch {
          throw new TransFiApiError({
            statusCode: response.status,
            providerCode: 'invalid_json_response',
            outcomeUnknown: input.method === 'POST' && response.status >= 500,
          });
        }
      }
      if (!response.ok) {
        throw new TransFiApiError({
          statusCode: response.status,
          providerCode: safeProviderCode(payload),
          outcomeUnknown: input.method === 'POST' && response.status >= 500,
        });
      }
      return payload as T;
    } catch (error) {
      if (error instanceof TransFiApiError) throw error;
      throw new TransFiApiError({
        statusCode: null,
        providerCode: error instanceof Error && error.name === 'AbortError' ? 'request_timeout' : 'network_error',
        outcomeUnknown: input.method === 'POST',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** New v3 sender field discovery endpoint (dynamic KYC/KYB schema). */
  getSenderMandatoryFields(input: TransFiMandatoryFieldsRequest): Promise<unknown> {
    return this.request('/v3/senders/mandatory-fields', {
      method: 'POST',
      body: {
        country: requireText(input.country, 'country').toUpperCase(),
        type: input.type,
        currencyType: input.currencyType,
      },
    });
  }

  /** Recipient field discovery follows the v3 recipient query contract. */
  getRecipientMandatoryFields(input: TransFiMandatoryFieldsRequest): Promise<unknown> {
    const query = new URLSearchParams({
      country: requireText(input.country, 'country').toUpperCase(),
      type: input.type,
      currencyType: input.currencyType,
    });
    return this.request(`/v3/recipients/mandatory-fields?${query.toString()}`, { method: 'GET' });
  }

  createSender(type: TransFiEntityType, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/v3/senders/${type}`, { method: 'POST', body: payload });
  }

  createRecipient(type: TransFiEntityType, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/v3/recipients/${type}`, { method: 'POST', body: payload });
  }

  listPaymentMethods(input: TransFiPaymentMethodsRequest): Promise<unknown> {
    const query = new URLSearchParams({
      direction: input.direction,
      country: requireText(input.country, 'country').toUpperCase(),
    });
    if (input.currency) query.set('currency', input.currency.toUpperCase());
    return this.request(`/v3/config/payment-methods?${query.toString()}`, { method: 'GET' });
  }

  createOrder(order: TransFiOrderRequest): Promise<unknown> {
    requireText(order.userId, 'order_user_id');
    requireText(order.purposeCode, 'order_purpose_code');
    const partnerId = requireText(order.partnerId, 'partner_id');
    if (partnerId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(partnerId)) {
      throw new Error('transfi_partner_id_invalid');
    }
    if (!order.source || !order.destination || typeof order.source !== 'object' || typeof order.destination !== 'object') {
      throw new Error('transfi_order_source_and_destination_required');
    }
    return this.request('/v3/orders', { method: 'POST', body: order as unknown as Record<string, unknown> });
  }

  getOrder(orderId: string): Promise<unknown> {
    return this.request(`/v3/orders/${encodeURIComponent(requireText(orderId, 'order_id'))}`, { method: 'GET' });
  }

  getBalance(): Promise<unknown> {
    return this.request('/v3/balance', { method: 'GET' });
  }
}
