const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export interface HttpMetricObservation {
  method: string;
  route: string | undefined;
  status: number;
  durationSeconds: number;
}

interface RequestSeries {
  method: string;
  route: string;
  status: number;
  count: number;
  durationSum: number;
  bucketCounts: number[];
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function normalizeMethod(method: string): string {
  const normalized = method.toUpperCase();
  return ALLOWED_METHODS.has(normalized) ? normalized : 'OTHER';
}

/**
 * Only Fastify's static route template should be passed here. URL paths,
 * query strings and unmatched dynamic paths are deliberately never labels.
 */
export function normalizeMetricRoute(route: string | undefined): string {
  if (
    typeof route !== 'string'
    || !route.startsWith('/')
    || route.length > 128
    || /[?#\r\n]/.test(route)
  ) return 'unmatched';
  return route;
}

export function createHttpMetrics() {
  const series = new Map<string, RequestSeries>();

  function observe(observation: HttpMetricObservation): void {
    if (!Number.isFinite(observation.durationSeconds) || observation.durationSeconds < 0) return;
    const method = normalizeMethod(observation.method);
    const route = normalizeMetricRoute(observation.route);
    const status = Number.isInteger(observation.status) && observation.status >= 100 && observation.status <= 599
      ? observation.status
      : 0;
    const key = JSON.stringify([method, route, status]);
    let item = series.get(key);
    if (!item) {
      item = {
        method,
        route,
        status,
        count: 0,
        durationSum: 0,
        bucketCounts: HISTOGRAM_BUCKETS.map(() => 0),
      };
      series.set(key, item);
    }
    item.count += 1;
    item.durationSum += observation.durationSeconds;
    HISTOGRAM_BUCKETS.forEach((bound, index) => {
      if (observation.durationSeconds <= bound) item!.bucketCounts[index] = (item!.bucketCounts[index] ?? 0) + 1;
    });
  }

  function render(nowSeconds = process.uptime(), memory = process.memoryUsage()): string {
    const lines: string[] = [
      '# HELP pixsplit_http_requests_total Total HTTP requests observed by the API process.',
      '# TYPE pixsplit_http_requests_total counter',
    ];
    for (const item of series.values()) {
      const labels = `method="${escapeLabel(item.method)}",route="${escapeLabel(item.route)}",status="${item.status}"`;
      lines.push(`pixsplit_http_requests_total{${labels}} ${item.count}`);
    }

    lines.push(
      '# HELP pixsplit_http_request_duration_seconds HTTP request duration in seconds.',
      '# TYPE pixsplit_http_request_duration_seconds histogram',
    );
    for (const item of series.values()) {
      const labels = `method="${escapeLabel(item.method)}",route="${escapeLabel(item.route)}",status="${item.status}"`;
      HISTOGRAM_BUCKETS.forEach((bound, index) => {
        lines.push(`pixsplit_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${item.bucketCounts[index] ?? 0}`);
      });
      lines.push(`pixsplit_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${item.count}`);
      lines.push(`pixsplit_http_request_duration_seconds_sum{${labels}} ${item.durationSum}`);
      lines.push(`pixsplit_http_request_duration_seconds_count{${labels}} ${item.count}`);
    }

    lines.push(
      '# HELP pixsplit_process_uptime_seconds Process uptime in seconds.',
      '# TYPE pixsplit_process_uptime_seconds gauge',
      `pixsplit_process_uptime_seconds ${Number.isFinite(nowSeconds) && nowSeconds >= 0 ? nowSeconds : 0}`,
      '# HELP pixsplit_process_resident_memory_bytes Resident memory size in bytes.',
      '# TYPE pixsplit_process_resident_memory_bytes gauge',
      `pixsplit_process_resident_memory_bytes ${memory.rss}`,
      '# HELP pixsplit_process_heap_used_bytes V8 heap memory currently in use.',
      '# TYPE pixsplit_process_heap_used_bytes gauge',
      `pixsplit_process_heap_used_bytes ${memory.heapUsed}`,
    );
    return lines.join('\n') + '\n';
  }

  return { observe, render };
}
