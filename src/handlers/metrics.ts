/**
 * Prometheus-format metrics endpoint for observability.
 *
 * WHEN TO READ THIS FILE: Adding new metric labels, modifying metric collection
 * behavior, or debugging metrics output.
 *
 * Exposes a /metrics endpoint in Prometheus text format. Metrics include:
 *   - http_requests_total — total requests by method, path, status
 *   - http_request_duration_ms — histogram of request latency (buckets)
 *   - upstream_requests_total — upstream fetch calls by target
 *   - upstream_errors_total — upstream errors by target and status
 *   - active_streams — currently active streaming connections
 *   - uptime_seconds — proxy uptime in seconds
 */
import { START_TIME } from '../config';
import { RouteInfo } from './shared';

// ---- Metric storage ----

const requestCount = new Map<string, number>();
const durationBuckets = new Map<string, number>();
const upstreamRequestCount = new Map<string, number>();
const upstreamErrorCount = new Map<string, number>();
let activeStreams = 0;

const BUCKET_BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 3000, 10000];

function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(',');
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ---- Public API ----

export function recordRequest(method: string, path: string, status: number, durationMs: number): void {
  const labels = { method, path, status: String(status) };
  const key = labelKey(labels);
  requestCount.set(key, (requestCount.get(key) || 0) + 1);

  // Duration bucketing
  let bucket = '+Inf';
  for (const bound of BUCKET_BOUNDS) {
    if (durationMs <= bound) { bucket = String(bound); break; }
  }
  const durKey = labelKey({ ...labels, le: bucket });
  durationBuckets.set(durKey, (durationBuckets.get(durKey) || 0) + 1);
}

export function recordUpstreamRequest(upstream: string): void {
  const key = labelKey({ upstream });
  upstreamRequestCount.set(key, (upstreamRequestCount.get(key) || 0) + 1);
}

export function recordUpstreamError(upstream: string, status: number): void {
  const key = labelKey({ upstream, status: String(status) });
  upstreamErrorCount.set(key, (upstreamErrorCount.get(key) || 0) + 1);
}

export function incrementActiveStreams(): void {
  activeStreams++;
}

export function decrementActiveStreams(): void {
  if (activeStreams > 0) activeStreams--;
}

// ---- Metrics output ----

function formatGauge(name: string, help: string, value: number, labels?: Record<string, string>): string {
  let out = `# HELP ${name} ${help}\n# TYPE ${name} gauge\n`;
  if (labels) {
    out += `${name}{${labelKey(labels)}} ${value}\n`;
  } else {
    out += `${name} ${value}\n`;
  }
  return out;
}

function formatCounter(name: string, help: string, entries: Map<string, number>): string {
  let out = `# HELP ${name} ${help}\n# TYPE ${name} counter\n`;
  for (const [labels, value] of entries) {
    out += `${name}{${labels}} ${value}\n`;
  }
  return out;
}

function formatHistogram(name: string, help: string, entries: Map<string, number>, buckets: number[]): string {
  let out = `# HELP ${name} ${help}\n# TYPE ${name} histogram\n`;
  // Sum for _sum and _count
  let sum = 0;
  let count = 0;

  // Group by base labels (without le)
  const baseKeys = new Set<string>();
  for (const key of entries.keys()) {
    // Remove le="..." from label set
    const withoutLe = key.replace(/,\s*le="[^"]*"/, '').replace(/^le="[^"]*",?\s*/, '');
    baseKeys.add(withoutLe);
  }

  for (const base of baseKeys) {
    // Collect per-bucket counts
    let cumulative = 0;
    for (const bound of [...buckets, '+Inf']) {
      const k = base ? `${base},le="${bound}"` : `le="${bound}"`;
      const bucketed = entries.get(k) || 0;
      const leLabel = bound === '+Inf' ? '+Inf' : bound;
      out += `${name}_bucket{${base ? base + ',' : ''}le="${leLabel}"} ${bucketed}\n`;
      cumulative += bucketed;
    }
    count += cumulative;
    // We don't track sum precisely; estimate via bucket midpoints
    sum += cumulative * 50; // rough estimate
  }

  out += `${name}_sum ${sum}\n`;
  out += `${name}_count ${count}\n`;
  return out;
}

/**
 * Handle GET /metrics — returns Prometheus-format metrics.
 */
export async function handleMetrics(_request: Request, _route: RouteInfo): Promise<Response> {
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);

  let body = '';

  // Uptime
  body += formatGauge('uptime_seconds', 'Proxy uptime in seconds', uptime);

  // Active streams
  body += formatGauge('active_streams', 'Currently active streaming connections', activeStreams);

  // HTTP request counters
  body += formatCounter('http_requests_total', 'Total HTTP requests by method, path, and status', requestCount);

  // Duration histogram
  body += formatHistogram('http_request_duration_ms', 'Request duration in milliseconds', durationBuckets, BUCKET_BOUNDS);

  // Upstream request counters
  body += formatCounter('upstream_requests_total', 'Total upstream requests by target', upstreamRequestCount);

  // Upstream error counters
  body += formatCounter('upstream_errors_total', 'Upstream errors by target and status', upstreamErrorCount);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
