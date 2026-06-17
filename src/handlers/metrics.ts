/**
 * Prometheus-format /metrics HTTP endpoint.
 *
 * Thin layer: delegates metric recording to MetricsRegistry and output
 * formatting to the pure formatter functions in src/metrics/.
 *
 * WHEN TO READ THIS FILE: Adding a new metric to the /metrics output.
 * To change *how* metrics are collected, see src/metrics/registry.ts.
 * To change *how* they are formatted, see src/metrics/formatter.ts.
 *
 * Metrics exposed:
 *   - http_requests_total       — counter by method, path, status
 *   - http_request_duration_ms  — histogram (exact sum, 10 buckets)
 *   - upstream_requests_total   — counter by upstream
 *   - upstream_errors_total     — counter by upstream, status
 *   - active_streams            — gauge
 *   - uptime_seconds            — gauge (computed at render time)
 */
import { metricsRegistry } from '../metrics';
import { formatGauge, formatCounter, formatHistogram } from '../metrics';
import { RouteInfo } from './shared';

/**
 * Handle GET /metrics — returns Prometheus-format plain text.
 */
export async function handleMetrics(_request: Request, _route: RouteInfo): Promise<Response> {
  let body = '';

  // Uptime gauge
  body += formatGauge('uptime_seconds', 'Proxy uptime in seconds', metricsRegistry.uptimeSeconds);

  // Active streams gauge
  body += formatGauge('active_streams', 'Currently active streaming connections', metricsRegistry.activeStreamsValue);

  // HTTP request counters
  body += formatCounter('http_requests_total', 'Total HTTP requests by method, path, and status', metricsRegistry.requestCountSnapshot);

  // Duration histogram (exact sum)
  body += formatHistogram('http_request_duration_ms', 'Request duration in milliseconds', metricsRegistry.durationBucketsSnapshot);

  // Upstream request counters
  body += formatCounter('upstream_requests_total', 'Total upstream requests by target', metricsRegistry.upstreamRequestCountSnapshot);

  // Upstream error counters
  body += formatCounter('upstream_errors_total', 'Upstream errors by target and status', metricsRegistry.upstreamErrorCountSnapshot);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
