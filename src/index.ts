/**
 * Hono app: CORS, route dispatch, instrumentation, and request handler.
 *
 * WHEN TO READ THIS FILE: Adding a new API route, modifying CORS config, or
 * debugging routing dispatch order. The actual handler logic lives in
 * request-handlers.ts.
 *
 * STARTUP SEQUENCE (for profiling):
 *   1. Module import — TypeScript evaluation, dependency resolution
 *   2. ensureTranslatorsRegistered() — plugin registry init
 *   3. ensureProvidersRegistered() — provider registry init
 *   4. Hono app construction — middleware stack setup
 *   5. First request — cold start (CF Workers: isolate warm-up)
 *
 * LOGGING: Every request gets a unique `req` (request_id). All log lines for
 * the same request share this ID, automatically injected by logger.ts via
 * AsyncLocalStorage. Use `withRequestId(generateId(), ...)` to wrap handlers.
 */
import { Hono } from 'hono';
import { routeConfig, getUpstream, upstreamFormat } from './routing';
import { checkBodySize } from './request';
import {
  handleAnthropicToOpenAI,
  handleOpenAIChatCompletions,
  handleResponsesAPI,
  handleModelList,
  handleHealthCheck,
  handleMetrics,
  handleUpstreamHealth,
  handleAuditLog,
  handleWebSocketUpgrade,
} from './handlers/index';
import { metricsRegistry } from './metrics';
import { ensureTranslatorsRegistered } from './translate/registry';
import { ensureProvidersRegistered } from './providers';
import { recordAudit } from './audit';
import { log, withRequestId, generateId } from './logger';

// ---- Startup profiling ----

const startupStart = Date.now();

// Initialize plugin registries at module load time
ensureTranslatorsRegistered();
ensureProvidersRegistered();

const startupMs = Date.now() - startupStart;
log.info('STARTUP', `Plugin registries initialized in ${startupMs}ms`, { startupMs, registries: ['translators', 'providers'] });
recordAudit('proxy', 'startup', { startupMs, registries: ['translators', 'providers'] });

// ---- Main Request Handler ----

/**
 * Local helper: record request metrics and access log.
 * For model-aware routes, uses the handler-resolved model (from RouteInfo.resolvedModel)
 * which captures the true model after URL → vision → thinking override chain.
 */
function recordMetrics(method: string, path: string, status: number, durationMs: number, routeInfo?: { modelOverride?: string | null; resolvedModel?: string }): void {
  metricsRegistry.recordRequest(method, path, status, durationMs);
  const model = routeInfo?.resolvedModel || routeInfo?.modelOverride || '(none)';
  metricsRegistry.recordModelRequest(model, status, durationMs);
  log.access(method, path, status, durationMs);
}

async function handleRequest(request: Request): Promise<Response> {
  const startTime = performance.now();
  const url = new URL(request.url);

  try {
    // WebSocket upgrade check (before routing & auth for /ws/ paths)
    if (url.pathname.startsWith('/ws/')) {
      const wsResp = await handleWebSocketUpgrade(request);
      if (wsResp) {
        recordMetrics('WS', url.pathname, wsResp.status, performance.now() - startTime);
        return wsResp;
      }
    }

    const route = routeConfig(request);
    const upstream = getUpstream(request, route.upstream);
    const fmt = upstreamFormat(request);

    // Create a mutable RouteInfo that handlers can augment with resolvedModel.
    // Handlers set routeInfo.resolvedModel after the full override chain;
    // we read it here after the handler returns.
    const routeInfo: {
      path: string;
      modelOverride?: string | null;
      upstream: string;
      resolvedModel?: string;
    } = {
      path: route.path,
      modelOverride: route.modelOverride,
      upstream,
      // Seed with URL-level override so early exits (auth failure, etc.)
      // still have a model. Handlers overwrite with body model later.
      resolvedModel: route.modelOverride || undefined,
    };

    // Body size gate — applies to all POST requests
    if (request.method === 'POST') {
      const sizeResp = await checkBodySize(request);
      if (sizeResp) {
        recordMetrics(request.method, url.pathname, 413, performance.now() - startTime);
        return sizeResp;
      }
    }

    // Metrics endpoint (no auth required)
    if (routeInfo.path === '/metrics' && request.method === 'GET') {
      const resp = await handleMetrics(request, routeInfo);
      recordMetrics(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Upstream health probe (no auth required)
    if (routeInfo.path === '/health/upstream' && request.method === 'GET') {
      const resp = await handleUpstreamHealth(request, routeInfo);
      recordMetrics(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Audit log (no auth for local debugging)
    if (routeInfo.path === '/audit/log' && request.method === 'GET') {
      const resp = await handleAuditLog(request, routeInfo);
      recordMetrics(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Anthropic → OpenAI (model-aware)
    if (routeInfo.path === '/v1/messages' && request.method === 'POST') {
      const resp = await handleAnthropicToOpenAI(request, routeInfo, fmt);
      recordMetrics(request.method, url.pathname, resp.status, performance.now() - startTime, routeInfo);
      return resp;
    }

    // OpenAI → Anthropic (or pass-through) (model-aware)
    if (routeInfo.path === '/v1/chat/completions' && request.method === 'POST') {
      const resp = await handleOpenAIChatCompletions(request, routeInfo, fmt);
      recordMetrics(request.method, url.pathname, resp.status, performance.now() - startTime, routeInfo);
      return resp;
    }

    // Responses API → Chat Completions (model-aware)
    if (routeInfo.path === '/v1/responses' && request.method === 'POST') {
      const resp = await handleResponsesAPI(request, routeInfo);
      recordMetrics(request.method, url.pathname, resp.status, performance.now() - startTime, routeInfo);
      return resp;
    }

    // Model discovery (with 300s cache) (model-aware)
    if (routeInfo.path === '/v1/models' && request.method === 'GET') {
      const resp = await handleModelList(request, routeInfo, fmt);
      recordMetrics(request.method, url.pathname, resp.status, performance.now() - startTime, routeInfo);
      return resp;
    }

    // Root health check (no auth required)
    if (routeInfo.path === '/' && request.method === 'GET') {
      const resp = await handleHealthCheck(upstream);
      recordMetrics(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // 404 for unknown paths
    recordMetrics(request.method, url.pathname, 404, performance.now() - startTime);
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const durationMs = performance.now() - startTime;
    recordMetrics(request.method, url.pathname, 500, durationMs);
    log.error('APP', `Unhandled exception: ${url.pathname}`, {
      path: url.pathname,
      error: err instanceof Error ? err.message : String(err),
    });
    recordAudit('error', 'unhandled_exception', {
      path: url.pathname,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ---- Hono App ----

const app = new Hono();

// CORS support for browser-based clients and preflight requests
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, Authorization, X-Upstream-Url, X-Upstream-Format, Anthropic-Version, Anthropic-Beta');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

// Wrap every request with a unique request_id for log correlation.
// Uses a module-level variable (CF Workers compatible) — each isolate
// processes one request at a time, so no AsyncLocalStorage needed.
app.all('*', (c) => {
  return withRequestId(generateId(), () => handleRequest(c.req.raw));
});

export default app;
