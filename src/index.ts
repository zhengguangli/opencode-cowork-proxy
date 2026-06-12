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
import { recordRequest } from './handlers/metrics';
import { ensureTranslatorsRegistered } from './translate/registry';
import { ensureProvidersRegistered } from './providers';
import { recordAudit } from './audit';
import { log } from './logger';

// ---- Startup profiling ----

const startupStart = Date.now();
let startupComplete = false;

// Initialize plugin registries at module load time
ensureTranslatorsRegistered();
ensureProvidersRegistered();

const startupMs = Date.now() - startupStart;
startupComplete = true;
log.info('STARTUP', `Plugin registries initialized in ${startupMs}ms`, { startupMs, registries: ['translators', 'providers'] });
recordAudit('proxy', 'startup', { startupMs, registries: ['translators', 'providers'] });

// ---- Main Request Handler ----

async function handleRequest(request: Request): Promise<Response> {
  const startTime = performance.now();
  const url = new URL(request.url);

  try {
    // WebSocket upgrade check (before routing & auth for /ws/ paths)
    if (url.pathname.startsWith('/ws/')) {
      const wsResp = await handleWebSocketUpgrade(request);
      if (wsResp) {
        recordRequest('WS', url.pathname, wsResp.status, performance.now() - startTime);
        return wsResp;
      }
    }

    const route = routeConfig(request);
    const upstream = getUpstream(request, route.upstream);
    const fmt = upstreamFormat(request);

    // Body size gate — applies to all POST requests
    if (request.method === 'POST') {
      const sizeResp = await checkBodySize(request);
      if (sizeResp) {
        recordRequest(request.method, url.pathname, 413, performance.now() - startTime);
        return sizeResp;
      }
    }

    // Metrics endpoint (no auth required)
    if (route.path === '/metrics' && request.method === 'GET') {
      const resp = await handleMetrics(request, { path: route.path, modelOverride: route.modelOverride, upstream });
      recordRequest(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Upstream health probe (no auth required)
    if (route.path === '/health/upstream' && request.method === 'GET') {
      const resp = await handleUpstreamHealth(request, { path: route.path, modelOverride: route.modelOverride, upstream });
      recordRequest(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Audit log (no auth for local debugging)
    if (route.path === '/audit/log' && request.method === 'GET') {
      const resp = await handleAuditLog(request, { path: route.path, modelOverride: route.modelOverride, upstream });
      recordRequest(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Anthropic → OpenAI
    if (route.path === '/v1/messages' && request.method === 'POST') {
      const resp = await handleAnthropicToOpenAI(request, { path: route.path, modelOverride: route.modelOverride, upstream }, fmt);
      recordRequest(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // OpenAI → Anthropic (or pass-through)
    if (route.path === '/v1/chat/completions' && request.method === 'POST') {
      const resp = await handleOpenAIChatCompletions(request, { path: route.path, modelOverride: route.modelOverride, upstream }, fmt);
      recordRequest(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Responses API → Chat Completions
    if (route.path === '/v1/responses' && request.method === 'POST') {
      const resp = await handleResponsesAPI(request, { path: route.path, modelOverride: route.modelOverride, upstream });
      recordRequest(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Model discovery (with 300s cache)
    if (route.path === '/v1/models' && request.method === 'GET') {
      const resp = await handleModelList(request, { path: route.path, modelOverride: route.modelOverride, upstream }, fmt);
      recordRequest(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // Root health check (no auth required)
    if (route.path === '/' && request.method === 'GET') {
      const resp = await handleHealthCheck(upstream);
      recordRequest(request.method, url.pathname, resp.status, performance.now() - startTime);
      return resp;
    }

    // 404 for unknown paths
    recordRequest(request.method, url.pathname, 404, performance.now() - startTime);
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    recordRequest(request.method, url.pathname, 500, performance.now() - startTime);
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

const app = new Hono();

// CORS support for browser-based clients and preflight requests
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, Authorization, X-Upstream-Url, X-Upstream-Format, Anthropic-Version, Anthropic-Beta');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.all('*', (c) => handleRequest(c.req.raw));

export default app;
