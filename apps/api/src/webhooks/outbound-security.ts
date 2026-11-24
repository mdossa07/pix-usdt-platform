import { lookup as dnsLookup } from 'node:dns/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { request as httpsRequest, type RequestOptions } from 'node:https';

export interface ResolvedWebhookTarget {
  url: URL;
  addresses: Array<{ address: string; family: number }>;
}

type DnsResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    ? parts
    : null;
}

function isPublicIpv4(address: string): boolean {
  const parts = ipv4Bytes(address);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6BigInt(address: string): bigint | null {
  if (isIP(address) !== 6 || address.includes('%')) return null;
  let value = address.toLowerCase();
  const ipv4Match = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Match) {
    const bytes = ipv4Bytes(ipv4Match[1]);
    if (!bytes) return null;
    const first = ((bytes[0] << 8) | bytes[1]).toString(16);
    const second = ((bytes[2] << 8) | bytes[3]).toString(16);
    value = value.slice(0, -ipv4Match[1].length) + first + ':' + second;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return BigInt('0x' + parts.map(part => part.padStart(4, '0')).join(''));
}

function matchesIpv6Prefix(value: bigint, prefix: bigint, bits: number): boolean {
  return (value >> BigInt(128 - bits)) === prefix;
}

function isPublicIpv6(address: string): boolean {
  const value = ipv6BigInt(address);
  if (value === null) return false;

  // Only global-unicast 2000::/3 is eligible. This excludes unspecified,
  // loopback, unique-local, link-local, multicast and IPv4-compatible ranges.
  if (!matchesIpv6Prefix(value, 0x1n, 3)) return false;
  if (matchesIpv6Prefix(value, 0x20010db8n, 32)) return false; // documentation
  if (matchesIpv6Prefix(value, 0x3fff0n, 20)) return false; // documentation
  if (matchesIpv6Prefix(value, 0x100080n, 23)) return false; // protocol assignments
  if (matchesIpv6Prefix(value, 0x2002n, 16)) return false; // 6to4
  if (matchesIpv6Prefix(value, 0x64ff9bn, 48)) return false; // NAT64 well-known prefix
  if ((value >> 32n) === 0xffffn) return false; // IPv4-mapped IPv6
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function parseWebhookEndpointUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid_webhook_url');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:'
    || (url.port !== '' && url.port !== '443')
    || url.username !== ''
    || url.password !== ''
    || url.hash !== ''
    || isIP(hostname) !== 0
    || !hostname.includes('.')
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.test')
    || hostname.endsWith('.invalid')
  ) {
    throw new Error('unsafe_webhook_url');
  }
  return url;
}

async function defaultResolver(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function resolvePublicWebhookTarget(
  value: string,
  resolver: DnsResolver = defaultResolver,
): Promise<ResolvedWebhookTarget> {
  const url = parseWebhookEndpointUrl(value);
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(url.hostname);
  } catch {
    throw new Error('webhook_host_resolution_failed');
  }
  if (
    addresses.length === 0
    || addresses.some(entry => !isPublicIpAddress(entry.address) || entry.family !== isIP(entry.address))
  ) {
    throw new Error('unsafe_webhook_host_address');
  }
  // Prefer IPv4 if both address families are available. The chosen address is
  // pinned into the TLS connection to prevent DNS rebinding between check/use.
  addresses.sort((a, b) => a.family - b.family);
  return { url, addresses };
}

export function buildWebhookSignature(secret: string, timestamp: string, rawBody: string): string {
  if (!secret || !/^\d{10}$/.test(timestamp)) throw new Error('invalid_webhook_signing_input');
  return createHmac('sha256', secret).update(timestamp + '.' + rawBody, 'utf8').digest('hex');
}

export function verifyWebhookSignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(buildWebhookSignature(secret, timestamp, rawBody), 'hex');
  } catch {
    return false;
  }
  const supplied = Buffer.from(signature, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export interface WebhookSendResult {
  statusCode: number;
}

export async function sendSignedWebhook(input: {
  endpointUrl: string;
  secret: string;
  eventId: string;
  eventName: string;
  payload: unknown;
  timeoutMs?: number;
  dnsResolver?: DnsResolver;
}): Promise<WebhookSendResult> {
  if (!input.secret || input.secret.length < 32) throw new Error('invalid_webhook_secret');
  const { url, addresses } = await resolvePublicWebhookTarget(input.endpointUrl, input.dnsResolver);
  const serializedBody = JSON.stringify(input.payload);
  if (typeof serializedBody !== 'string') throw new Error('webhook_payload_not_serializable');
  const rawBody = serializedBody;
  if (Buffer.byteLength(rawBody, 'utf8') > 256 * 1024) throw new Error('webhook_payload_too_large');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = buildWebhookSignature(input.secret, timestamp, rawBody);
  const chosen = addresses[0];

  return new Promise((resolve, reject) => {
    let responseBytes = 0;
    const requestOptions: RequestOptions = {
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      method: 'POST',
      path: url.pathname + url.search,
      servername: url.hostname,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody, 'utf8'),
        'User-Agent': 'PixSplit-Webhooks/1.0',
        'X-PixSplit-Event': input.eventName,
        'X-PixSplit-Event-Id': input.eventId,
        'X-PixSplit-Timestamp': timestamp,
        'X-PixSplit-Signature': 'sha256=' + signature,
      },
      lookup: ((
        _hostname: string,
        options: { all?: boolean } | number,
        callback: (
          error: NodeJS.ErrnoException | null,
          address: string | Array<{ address: string; family: number }>,
          family?: number,
        ) => void,
      ) => {
        if (typeof options === 'object' && options.all) callback(null, addresses);
        else callback(null, chosen.address, chosen.family);
      }) as unknown as NonNullable<RequestOptions['lookup']>,
    };

    const request = httpsRequest(requestOptions, response => {
      response.on('data', chunk => {
        responseBytes += Buffer.byteLength(chunk);
        if (responseBytes > 8192) request.destroy(new Error('webhook_response_too_large'));
      });
      response.on('end', () => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) resolve({ statusCode });
        else reject(new Error(statusCode >= 300 && statusCode < 400 ? 'webhook_redirect_rejected' : 'webhook_http_' + statusCode));
      });
    });
    request.setTimeout(input.timeoutMs ?? 5000, () => request.destroy(new Error('webhook_timeout')));
    request.on('error', error => reject(new Error(error.message.replace(/\s+/g, '_').slice(0, 120))));
    request.end(rawBody);
  });
}
