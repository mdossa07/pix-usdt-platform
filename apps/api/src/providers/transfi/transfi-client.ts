import { config } from '../../config.js';

export type TransFiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type TransFiCurrencyType = 'fiat' | 'crypto';
export type TransFiUserKind = 'individual' | 'organization';
export type TransFiPaymentDirection = 'deposit' | 'withdraw';
export type TransFiOrderType =
  | 'onramp'
  | 'offramp'
  | 'payin'
  | 'payout'
  | 'fiat_prefund'
  | 'crypto_prefund'
  | 'swap'
  | 'gaming';

export interface TransFiRequestInput {
  method: TransFiMethod;
  path: string;
  body?: unknown;
  midOverride?: string;
}

export interface TransFiResponse<T = unknown> {
  status: number;
  data: T;
  requestId?: string;
}

export interface TransFiClientOptions {
  baseUrl?: string;
  username?: string;
  password?: string;
  mid?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TransFiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'TransFiClientError';
  }
}

export interface TransFiSenderFieldsInput {
  type: TransFiUserKind;
  geo: string;
  currencyType: TransFiCurrencyType;
}

export interface TransFiRecipientFieldsInput {
  type: TransFiUserKind;
  geo: string;
  currencyType: TransFiCurrencyType;
}

export interface TransFiPaymentMethodsInput {
  direction: TransFiPaymentDirection;
  country?: string;
  currency?: string;
  limit?: number;
  page?: number;
  headlessMode?: boolean;
  userType?: 'individual' | 'business';
}

export interface TransFiListOrdersInput {
  page?: number;
  limit?: number;
  status?: string;
  orderType?: TransFiOrderType;
  fromDate?: string;
  toDate?: string;
  userId?: string;
  currency?: string;
}

export interface TransFiOrderInput {
  partnerId: string;
  orderType: TransFiOrderType;
  purposeCode: string;
  userId?: string;
  purposeCodeReason?: string;
  source: Record<string, unknown>;
  destination: Record<string, unknown>;
  [key: string]: unknown;
}

function toQueryString(values: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function hasAmount(value: Record<string, unknown>): boolean {
  return value.amount !== undefined && value.amount !== null && value.amount !== '';
}

function validateTwoLetterCountry(value: string, field: string): void {
  if (!/^[A-Z]{2}$/.test(value)) throw new Error(`invalid_transfi_${field}`);
}

export class TransFiClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly defaultMid: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: TransFiClientOptions = {}) {
    const configuredBaseUrl = options.baseUrl ?? config.TRANSFI_BASE_URL;
    const base = new URL(configuredBaseUrl);
    const supportedHosts = new Set(['sandbox-api.transfi.com', 'api.transfi.com']);
    if (base.protocol !== 'https:' || !supportedHosts.has(base.hostname) || base.pathname !== '/') {
      throw new Error('invalid_transfi_base_url');
    }

    this.baseUrl = base.origin;
    this.username = options.username ?? config.TRANSFI_USERNAME;
    this.password = options.password ?? config.TRANSFI_PASSWORD;
    this.defaultMid = options.mid ?? config.TRANSFI_MID;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async request<T = unknown>(input: TransFiRequestInput): Promise<TransFiResponse<T>> {
    if (!input.path.startsWith('/v3/') || input.path.startsWith('//')) {
      throw new Error('transfi_v3_path_required');
    }
    if (!this.username || !this.password) {
      throw new Error('transfi_credentials_not_configured');
    }

    const mid = input.midOverride || this.defaultMid;
    if (!mid) throw new Error('transfi_mid_required');

    const url = new URL(input.path, this.baseUrl);
    if (url.origin !== this.baseUrl || !url.pathname.startsWith('/v3/')) {
      throw new Error('invalid_transfi_request_url');
    }

    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
      Accept: 'application/json',
      MID: mid,
    };
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: input.method,
        headers,
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_network_error';
      throw new TransFiClientError(`TransFi network request failed: ${message}`, 0);
    }

    let data: unknown = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    } else {
      const text = await response.text().catch(() => '');
      data = text || null;
    }

    const bodyRequestId = data && typeof data === 'object' && 'traceId' in data
      ? String((data as { traceId?: unknown }).traceId ?? '')
      : undefined;
    const requestId = response.headers.get('x-request-id') || bodyRequestId || undefined;

    if (!response.ok) {
      throw new TransFiClientError(
        `TransFi API error: ${response.status} ${response.statusText}`,
        response.status,
        requestId,
        data,
      );
    }

    return {
      status: response.status,
      data: data as T,
      requestId,
    };
  }

  getSenderMandatoryFields(input: TransFiSenderFieldsInput, midOverride?: string) {
    validateTwoLetterCountry(input.geo, 'sender_geo');
    return this.request({
      method: 'POST',
      path: '/v3/senders/mandatory-fields',
      body: input,
      midOverride,
    });
  }

  createIndividualSender(body: Record<string, unknown>, midOverride?: string) {
    return this.request({ method: 'POST', path: '/v3/senders/individual', body, midOverride });
  }

  createBusinessSender(body: Record<string, unknown>, midOverride?: string) {
    return this.request({ method: 'POST', path: '/v3/senders/business', body, midOverride });
  }

  getRecipientMandatoryFields(input: TransFiRecipientFieldsInput, midOverride?: string) {
    validateTwoLetterCountry(input.geo, 'recipient_geo');
    return this.request({
      method: 'POST',
      path: '/v3/recipients/mandatory-fields',
      body: input,
      midOverride,
    });
  }

  createIndividualRecipient(body: Record<string, unknown>, midOverride?: string) {
    return this.request({ method: 'POST', path: '/v3/recipients/individual', body, midOverride });
  }

  createBusinessRecipient(body: Record<string, unknown>, midOverride?: string) {
    return this.request({ method: 'POST', path: '/v3/recipients/business', body, midOverride });
  }

  listPaymentMethods(input: TransFiPaymentMethodsInput, midOverride?: string) {
    if (!['deposit', 'withdraw'].includes(input.direction)) throw new Error('invalid_transfi_payment_direction');
    return this.request({
      method: 'GET',
      path: `/v3/config/payment-methods${toQueryString(input)}`,
      midOverride,
    });
  }

  createOrder(input: TransFiOrderInput, midOverride?: string) {
    if (!input.partnerId || input.partnerId.trim() !== input.partnerId || input.partnerId.length > 128) {
      throw new Error('invalid_transfi_partner_id');
    }
    if (!input.purposeCode || !input.purposeCode.trim()) throw new Error('transfi_purpose_code_required');
    if (input.purposeCode === 'other' && !input.purposeCodeReason?.trim()) {
      throw new Error('transfi_purpose_code_reason_required');
    }
    if (!input.source || typeof input.source !== 'object' || Array.isArray(input.source)) {
      throw new Error('transfi_source_required');
    }
    if (!input.destination || typeof input.destination !== 'object' || Array.isArray(input.destination)) {
      throw new Error('transfi_destination_required');
    }

    const sourceHasAmount = hasAmount(input.source);
    const destinationHasAmount = hasAmount(input.destination);
    if (sourceHasAmount === destinationHasAmount) {
      throw new Error('transfi_exactly_one_order_amount_required');
    }

    const requiresUserId = ['payin', 'payout', 'swap', 'gaming'].includes(input.orderType);
    if (requiresUserId && (!input.userId || !/^UX-[A-Za-z0-9-]+$/.test(input.userId))) {
      throw new Error('transfi_user_id_required');
    }

    return this.request({
      method: 'POST',
      path: '/v3/orders',
      body: input,
      midOverride,
    });
  }

  getOrder(orderId: string, midOverride?: string) {
    if (!/^OR-[A-Za-z0-9-]+$/.test(orderId)) throw new Error('invalid_transfi_order_id');
    return this.request({
      method: 'GET',
      path: `/v3/orders/${encodeURIComponent(orderId)}`,
      midOverride,
    });
  }

  listOrders(input: TransFiListOrdersInput = {}, midOverride?: string) {
    return this.request({
      method: 'GET',
      path: `/v3/orders${toQueryString(input)}`,
      midOverride,
    });
  }

  getBalance(input: { currency?: string; date?: string; limit?: number; page?: number } = {}, midOverride?: string) {
    return this.request({
      method: 'GET',
      path: `/v3/balance${toQueryString(input)}`,
      midOverride,
    });
  }

  startStandardKyc(userId: string, midOverride?: string) {
    if (!/^UX-[A-Za-z0-9-]+$/.test(userId)) throw new Error('invalid_transfi_user_id');
    return this.request({
      method: 'POST',
      path: '/v3/kyc/standard',
      body: { userId },
      midOverride,
    });
  }

  startStandardKyb(userId: string, midOverride?: string) {
    if (!/^UX-[A-Za-z0-9-]+$/.test(userId)) throw new Error('invalid_transfi_user_id');
    return this.request({
      method: 'POST',
      path: '/v3/kyb/standard',
      body: { userId, uiEnabled: true },
      midOverride,
    });
  }

  getKycAccountStatus(userId: string, accountType: 'sender' | 'recipient' | 'both' = 'both', midOverride?: string) {
    if (!/^UX-[A-Za-z0-9-]+$/.test(userId)) throw new Error('invalid_transfi_user_id');
    return this.request({
      method: 'GET',
      path: `/v3/kyc/account-status${toQueryString({ userId, accountType })}`,
      midOverride,
    });
  }

  getKybAccountStatus(userId: string, accountType: 'sender' | 'recipient' | 'both' = 'both', midOverride?: string) {
    if (!/^UX-[A-Za-z0-9-]+$/.test(userId)) throw new Error('invalid_transfi_user_id');
    return this.request({
      method: 'GET',
      path: `/v3/kyb/account-status${toQueryString({ userId, accountType })}`,
      midOverride,
    });
  }
}
