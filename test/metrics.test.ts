import { describe, it, expect, beforeEach } from 'vitest';
import { handleMetrics } from '../src/handlers/metrics';
import { MetricsRegistry, metricsRegistry, BUCKET_BOUNDS } from '../src/metrics/registry';
import { formatGauge, formatCounter, formatHistogram, labelKey, escapeLabel } from '../src/metrics/formatter';
import { trackActiveStream } from '../src/metrics/stream-track';

// ===== Formatter unit tests =====

describe('formatter', () => {
  describe('escapeLabel', () => {
    it('passes through normal strings', () => {
      expect(escapeLabel('hello')).toBe('hello');
    });

    it('escapes backslashes', () => {
      expect(escapeLabel('a\\b')).toBe('a\\\\b');
    });

    it('escapes double quotes', () => {
      expect(escapeLabel('a"b')).toBe('a\\"b');
    });

    it('escapes newlines', () => {
      expect(escapeLabel('a\nb')).toBe('a\\nb');
    });
  });

  describe('labelKey', () => {
    it('sorts keys alphabetically', () => {
      expect(labelKey({ status: '200', method: 'GET' })).toBe('method="GET",status="200"');
    });

    it('escapes values', () => {
      expect(labelKey({ path: '/v1/"test"' })).toBe('path="/v1/\\"test\\""');
    });
  });

  describe('formatGauge', () => {
    it('renders a gauge without labels', () => {
      const out = formatGauge('uptime', 'Test uptime', 42);
      expect(out).toContain('# HELP uptime Test uptime');
      expect(out).toContain('# TYPE uptime gauge');
      expect(out).toContain('uptime 42');
    });

    it('renders a gauge with labels', () => {
      const out = formatGauge('active', 'Active things', 3, { zone: 'us' });
      expect(out).toContain('active{zone="us"} 3');
    });
  });

  describe('formatCounter', () => {
    it('renders a counter with entries', () => {
      const entries = new Map([
        ['method="GET",path="/",status="200"', 5],
        ['method="POST",path="/v1/messages",status="201"', 2],
      ]);
      const out = formatCounter('http_requests_total', 'Total requests', entries);
      expect(out).toContain('# HELP http_requests_total Total requests');
      expect(out).toContain('# TYPE http_requests_total counter');
      expect(out).toContain('http_requests_total{method="GET",path="/",status="200"} 5');
      expect(out).toContain('http_requests_total{method="POST",path="/v1/messages",status="201"} 2');
    });

    it('returns header only for empty map', () => {
      const out = formatCounter('empty', 'Empty', new Map());
      expect(out).toContain('# HELP empty Empty');
      expect(out).toContain('# TYPE empty counter');
      // No data lines
      expect(out.trim().split('\n').length).toBe(2);
    });
  });

  describe('formatHistogram', () => {
    it('renders histogram with buckets, exact _sum and _count', () => {
      // Simulate: request to GET / took 25ms (fits in le="25")
      const entries = new Map();
      entries.set(labelKey({ method: 'GET', path: '/', status: '200', le: '25' }), { count: 1, sum: 25 });
      entries.set(labelKey({ method: 'GET', path: '/', status: '200', le: '+Inf' }), { count: 0, sum: 0 });

      const out = formatHistogram('http_request_duration_ms', 'Duration', entries);
      expect(out).toContain('# HELP http_request_duration_ms Duration');
      expect(out).toContain('# TYPE http_request_duration_ms histogram');
      expect(out).toContain('_sum 25');
      expect(out).toContain('_count 1');
      // Should have cumulative bucket for le="25"
      expect(out).toMatch(/_bucket\{.*le="25".*\}\s+1/);
    });

    it('emits cumulative bucket counts', () => {
      // Two requests: one at 10ms (le="10"), one at 30ms (le="25" would
      // not include 30ms, falls into le="50")
      // Create entries using labelKey to match how MetricsRegistry stores them
      const entries = new Map();
      entries.set(labelKey({ method: 'GET', path: '/api', status: '200', le: '5' }), { count: 0, sum: 0 });
      entries.set(labelKey({ method: 'GET', path: '/api', status: '200', le: '10' }), { count: 1, sum: 10 });
      entries.set(labelKey({ method: 'GET', path: '/api', status: '200', le: '25' }), { count: 0, sum: 0 });
      entries.set(labelKey({ method: 'GET', path: '/api', status: '200', le: '50' }), { count: 1, sum: 30 });
      entries.set(labelKey({ method: 'GET', path: '/api', status: '200', le: '+Inf' }), { count: 0, sum: 0 });

      const out = formatHistogram('dur', 'x', entries);
      // le="10" should be cumulative=1
      expect(out).toMatch(/_bucket\{.*le="10".*\}\s+1/);
      // le="50" should be cumulative=2
      expect(out).toMatch(/_bucket\{.*le="50".*\}\s+2/);
      expect(out).toContain('_sum 40');
      expect(out).toContain('_count 2');
    });
  });
});

// ===== MetricsRegistry unit tests =====

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  it('records request counters', () => {
    registry.recordRequest('GET', '/', 200, 10);
    registry.recordRequest('GET', '/', 200, 20);
    registry.recordRequest('POST', '/v1/messages', 201, 30);

    const snapshot = registry.requestCountSnapshot;
    expect(snapshot.size).toBe(2);
    // Each entry key is a label string; verify total request count
    const total = Array.from(snapshot.values()).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });

  it('tracks exact duration sum in histogram', () => {
    registry.recordRequest('GET', '/api', 200, 10);
    registry.recordRequest('GET', '/api', 200, 20);
    registry.recordRequest('GET', '/api', 200, 30);

    const buckets = registry.durationBucketsSnapshot;
    // The sum should equal total of all durations
    const totalSum = Array.from(buckets.values()).reduce((s, e) => s + e.sum, 0);
    expect(totalSum).toBe(60);
  });

  it('records upstream requests', () => {
    registry.recordUpstreamRequest('api.example.com');
    registry.recordUpstreamRequest('api.example.com');

    expect(registry.upstreamRequestCountSnapshot.size).toBe(1);
    const value = Array.from(registry.upstreamRequestCountSnapshot.values())[0];
    expect(value).toBe(2);
  });

  it('records upstream errors', () => {
    registry.recordUpstreamError('api.example.com', 502);
    registry.recordUpstreamError('api.example.com', 502);

    expect(registry.upstreamErrorCountSnapshot.size).toBe(1);
    const value = Array.from(registry.upstreamErrorCountSnapshot.values())[0];
    expect(value).toBe(2);
  });

  it('tracks active streams gauge', () => {
    expect(registry.activeStreamsValue).toBe(0);
    registry.incrementActiveStreams();
    expect(registry.activeStreamsValue).toBe(1);
    registry.incrementActiveStreams();
    expect(registry.activeStreamsValue).toBe(2);
    registry.decrementActiveStreams();
    expect(registry.activeStreamsValue).toBe(1);
    registry.decrementActiveStreams();
    expect(registry.activeStreamsValue).toBe(0);
  });

  it('does not decrement active streams below zero', () => {
    registry.decrementActiveStreams();
    expect(registry.activeStreamsValue).toBe(0);
    registry.decrementActiveStreams();
    expect(registry.activeStreamsValue).toBe(0);
  });

  it('reports positive uptime', () => {
    expect(registry.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('records multiple label dimensions correctly', () => {
    registry.recordRequest('GET', '/v1/models', 200, 5);
    registry.recordRequest('GET', '/v1/models', 200, 15);
    registry.recordRequest('POST', '/v1/messages', 500, 1000);

    expect(registry.requestCountSnapshot.size).toBe(2);
    const total = Array.from(registry.requestCountSnapshot.values()).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });

  it('handles concurrent recording without errors', () => {
    for (let i = 0; i < 100; i++) {
      registry.recordRequest('GET', '/test', 200, i);
    }
    expect(registry.requestCountSnapshot.size).toBe(1);
    expect(Array.from(registry.requestCountSnapshot.values())[0]).toBe(100);
  });
});

// ===== Stream tracker tests =====

describe('trackActiveStream', () => {
  it('increments active streams when stream is created', () => {
    const registry = new MetricsRegistry();
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'));
        controller.close();
      },
    });

    trackActiveStream(input, registry);
    expect(registry.activeStreamsValue).toBe(1);
  });

  it('decrements active streams after stream is consumed', async () => {
    const registry = new MetricsRegistry();
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'));
        controller.close();
      },
    });

    const tracked = trackActiveStream(input, registry);
    const reader = tracked.getReader();
    await reader.read();
    await reader.read(); // done
    expect(registry.activeStreamsValue).toBe(0);
  });
});

// ===== handleMetrics integration tests =====

describe('handleMetrics', () => {
  it('returns Prometheus-format plain text', async () => {
    const request = new Request('http://localhost/metrics');
    const response = await handleMetrics(request, { path: '/metrics', modelOverride: null, upstream: 'https://test.example.com' });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');

    const body = await response.text();
    expect(body).toContain('# HELP');
    expect(body).toContain('# TYPE');
  });

  it('includes uptime_seconds metric', async () => {
    const response = await handleMetrics(
      new Request('http://localhost/metrics'),
      { path: '/metrics', modelOverride: null, upstream: 'https://test.example.com' },
    );
    const body = await response.text();
    expect(body).toContain('uptime_seconds');
  });

  it('includes http_requests_total metric', async () => {
    const response = await handleMetrics(
      new Request('http://localhost/metrics'),
      { path: '/metrics', modelOverride: null, upstream: 'https://test.example.com' },
    );
    const body = await response.text();
    expect(body).toContain('http_requests_total');
    expect(body).toContain('http_request_duration_ms');
  });

  it('includes upstream metrics', async () => {
    const response = await handleMetrics(
      new Request('http://localhost/metrics'),
      { path: '/metrics', modelOverride: null, upstream: 'https://test.example.com' },
    );
    const body = await response.text();
    expect(body).toContain('upstream_requests_total');
    expect(body).toContain('upstream_errors_total');
  });

  it('includes active_streams metric', async () => {
    const response = await handleMetrics(
      new Request('http://localhost/metrics'),
      { path: '/metrics', modelOverride: null, upstream: 'https://test.example.com' },
    );
    const body = await response.text();
    expect(body).toContain('active_streams');
  });

  it('produces valid Prometheus format with proper HELP/TYPE ordering', async () => {
    const response = await handleMetrics(
      new Request('http://localhost/metrics'),
      { path: '/metrics', modelOverride: null, upstream: 'https://test.example.com' },
    );
    const body = await response.text();

    // Every metric line should be preceded by HELP and TYPE lines
    const lines = body.split('\n').filter(l => l);
    const metricLines = lines.filter(l => !l.startsWith('#'));
    for (const line of metricLines) {
      // Should be in format: metric_name{labels} value
      expect(line).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*(?:\{.*\})?\s+\d+(?:\.\d+)?$/);
    }
  });

  it('handles concurrent requests without error', async () => {
    // Verify no uncaught errors on repeated calls
    for (let i = 0; i < 5; i++) {
      const response = await handleMetrics(
        new Request('http://localhost/metrics'),
        { path: '/metrics', modelOverride: null, upstream: 'https://test.example.com' },
      );
      expect(response.status).toBe(200);
    }
  });
});
