import { config } from '../../config.js';

export interface TransFiRequestInput {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  midOverride?: string;
}

export interface TransFiResponse<T = unknown> {
  status: number;
  data: T;
  requestId?: string;
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

export class TransFiClient {
  private readonly baseUrl: string;
  private readonly basicAuth: string;
  private readonly defaultMid: string;

  constructor() {
    this.baseUrl = config.TRANSFI_BASE_URL.replace(/\/+$/, '');
    const username = config.TRANSFI_USERNAME || '';
    const password = config.TRANSFI_PASSWORD || '';
    this.basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    this.defaultMid = config.TRANSFI_MID || '';
  }

  async request<T = unknown>(input: TransFiRequestInput): Promise<TransFiResponse<T>> {
    const url = `${this.baseUrl}${input.path.startsWith('/') ? input.path : `/${input.path}`}`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${this.basicAuth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const mid = input.midOverride || this.defaultMid;
    if (mid) {
      headers['mid'] = mid;
    }

    if (input.idempotencyKey) {
      headers['Idempotency-Key'] = input.idempotencyKey;
    }

    const response = await fetch(url, {
      method: input.method,
      headers,
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

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

    if (!response.ok) {
      throw new TransFiClientError(
        `TransFi API error: ${response.status} ${response.statusText}`,
        response.status,
        response.headers.get('x-request-id') || undefined,
        data,
      );
    }

    return {
      status: response.status,
      data: data as T,
      requestId: response.headers.get('x-request-id') || undefined,
    };
  }
}