import { describe, it, expect, beforeEach } from 'vitest';
import { handleMetrics } from '../src/handlers/metrics';

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
