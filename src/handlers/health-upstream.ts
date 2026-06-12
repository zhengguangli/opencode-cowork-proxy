/**
 * Upstream health check endpoint — validates upstream connectivity.
 *
 * WHEN TO READ THIS FILE: Adding new health check probes, changing probe behavior,
 * or debugging upstream connectivity issues.
 *
 * Does NOT block on upstream health checks by default — only probes when
 * ?probe=true query parameter is set, to avoid wasting upstream request quota.
 * Lightweight check: hits the upstream /v1/models endpoint with a short timeout.
 */
import { MODEL_LIST_TIMEOUT } from '../config';
import { safeUpstreamFetch, upstreamErrorResponse } from '../request';
import { RouteInfo } from './shared';

interface HealthResult {
  upstream: string;
  status: 'ok' | 'degraded' | 'error';
  reachable: boolean;
  latencyMs?: number;
  error?: string;
  probed: boolean;
}

/**
 * Handle GET /health/upstream — reports upstream connectivity.
 *
 * Without ?probe=true: returns cached/config info only (no active probe).
 * With ?probe=true: performs a lightweight GET to /v1/models with 10s timeout.
 */
export async function handleUpstreamHealth(
  _request: Request,
  route: RouteInfo,
): Promise<Response> {
  const url = new URL(_request.url);
  const shouldProbe = url.searchParams.get('probe') === 'true';
  const upstream = route.upstream;

  const result: HealthResult = {
    upstream,
    status: 'ok',
    reachable: true,
    probed: shouldProbe,
  };

  if (shouldProbe) {
    const start = performance.now();
    try {
      const res = await safeUpstreamFetch(`${upstream}/v1/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT),
      });

      result.latencyMs = Math.round(performance.now() - start);

      if (res.ok) {
        result.status = 'ok';
        result.reachable = true;
      } else {
        result.status = 'degraded';
        result.reachable = false;
        result.error = `Upstream returned status ${res.status}`;
        const body = await res.text().catch(() => '');
        if (body) result.error += `: ${body.slice(0, 200)}`;
      }
    } catch (err: unknown) {
      result.latencyMs = Math.round(performance.now() - start);
      result.status = 'error';
      result.reachable = false;
      result.error = err instanceof Error ? err.message : String(err);
    }
  }

  const httpStatus = result.status === 'ok' ? 200 : 503;
  return new Response(JSON.stringify(result, null, 2), {
    status: httpStatus,
    headers: { 'Content-Type': 'application/json' },
  });
}
