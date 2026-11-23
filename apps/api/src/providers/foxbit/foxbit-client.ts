import { createHmac } from 'node:crypto';

export type FoxbitConfig = { baseUrl: string; apiKey: string; apiSecret: string; };
type QueryEntry = [string, string];

/**
 * Authenticated Foxbit REST v3 transport.
 * This transport does not assume the commercial funds flow. Endpoint methods are added only
 * after Foxbit confirms the correct product, account model and sandbox schema in writing.
 */
export class FoxbitClient {
  private readonly baseUrl: string;

  constructor(private readonly config: FoxbitConfig) {
    if (!config.apiKey || !config.apiSecret) throw new Error('Foxbit API credentials are not configured.');
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  async request<T>(input: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    query?: QueryEntry[];
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<T> {
    const method = input.method;
    const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
    const basePath = new URL(this.baseUrl).pathname.replace(/\/$/, '');
    const requestPathForSignature = `${basePath}${path}`;
    const query = input.query ?? [];
    const queryForSignature = query.map(([k, v]) => `${k}=${v}`).join('&');
    const encodedQuery = new URLSearchParams(query.map(([key, value]) => [key, value])).toString();
    const rawBody = input.body === undefined ? '' : JSON.stringify(input.body);
    const timestamp = Date.now().toString();
    const prehash = `${timestamp}${method}${requestPathForSignature}${queryForSignature}${rawBody}`;
    const signature = createHmac('sha256', this.config.apiSecret).update(prehash).digest('hex');
    const url = `${this.baseUrl}${path}${encodedQuery ? `?${encodedQuery}` : ''}`;
    const headers: Record<string, string> = {
      'X-FB-ACCESS-KEY': this.config.apiKey,
      'X-FB-ACCESS-TIMESTAMP': timestamp,
      'X-FB-ACCESS-SIGNATURE': signature,
      'X-FB-RECEIVE-WINDOW': '15000',
    };
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';
    if (input.idempotencyKey) headers['X-Idempotent'] = input.idempotencyKey;

    const response = await fetch(url, {
      method,
      headers,
      body: input.body === undefined ? undefined : rawBody,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let payload: unknown = text;
    try { payload = text ? JSON.parse(text) : null; } catch { /* preserve provider response */ }
    if (!response.ok) throw new FoxbitApiError(response.status, payload);
    return payload as T;
  }
}

export class FoxbitApiError extends Error {
  constructor(public readonly status: number, public readonly providerPayload: unknown) {
    super(`Foxbit API returned HTTP ${status}`);
    this.name = 'FoxbitApiError';
  }
}
