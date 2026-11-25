import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpMetrics, normalizeMetricRoute } from './http-metrics.js';

test('uses only static route templates and falls back for dynamic or invalid paths', () => {
  assert.equal(normalizeMetricRoute('/v1/payments/:paymentId'), '/v1/payments/:paymentId');
  assert.equal(normalizeMetricRoute(undefined), 'unmatched');
  assert.equal(normalizeMetricRoute('/v1/payments/secret-id?token=secret'), 'unmatched');
  assert.equal(normalizeMetricRoute('/v1/payments/secret-id#fragment'), 'unmatched');
  assert.equal(normalizeMetricRoute('/bad\nroute'), 'unmatched');
});

test('renders request counters, cumulative duration buckets and process gauges', () => {
  const metrics = createHttpMetrics();
  metrics.observe({ method: 'GET', route: '/health', status: 200, durationSeconds: 0.004 });
  metrics.observe({ method: 'POST', route: '/v1/payments/:paymentId', status: 401, durationSeconds: 0.2 });
  metrics.observe({ method: 'GET', route: '/health', status: 200, durationSeconds: 0.02 });

  const output = metrics.render(12.5, { rss: 1000, heapUsed: 500 } as NodeJS.MemoryUsage);
  assert.match(output, /pixsplit_http_requests_total\{method="GET",route="\/health",status="200"\} 2/);
  assert.match(output, /pixsplit_http_request_duration_seconds_bucket\{method="GET",route="\/health",status="200",le="0.005"\} 1/);
  assert.match(output, /pixsplit_http_request_duration_seconds_bucket\{method="GET",route="\/health",status="200",le="\+Inf"\} 2/);
  assert.match(output, /pixsplit_http_request_duration_seconds_count\{method="POST",route="\/v1\/payments\/:paymentId",status="401"\} 1/);
  assert.match(output, /pixsplit_process_uptime_seconds 12.5/);
  assert.match(output, /pixsplit_process_resident_memory_bytes 1000/);
  assert.match(output, /pixsplit_process_heap_used_bytes 500/);
});

test('normalizes unknown methods and excludes invalid observations', () => {
  const metrics = createHttpMetrics();
  metrics.observe({ method: 'CUSTOM', route: '/health', status: 700, durationSeconds: 1 });
  metrics.observe({ method: 'GET', route: '/health', status: 200, durationSeconds: -1 });
  const output = metrics.render(1, { rss: 1, heapUsed: 1 } as NodeJS.MemoryUsage);
  assert.match(output, /method="OTHER",route="\/health",status="0"/);
  assert.doesNotMatch(output, /method="GET",route="\/health",status="200"/);
});

test('escapes route labels safely instead of breaking exposition format', () => {
  const metrics = createHttpMetrics();
  metrics.observe({ method: 'GET', route: '/v1/items/"quoted"\\segment', status: 200, durationSeconds: 0.1 });
  const output = metrics.render(1, { rss: 1, heapUsed: 1 } as NodeJS.MemoryUsage);
  assert.match(output, /route="\/v1\/items\/\\\"quoted\\\"\\\\segment"/);
});
