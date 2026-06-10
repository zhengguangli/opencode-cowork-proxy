/**
 * Hono app: CORS, route dispatch, and request handler.
 *
 * WHEN TO READ THIS FILE: Adding a new API route, modifying CORS config, or
 * debugging routing dispatch order. The actual handler logic lives in
 * request-handlers.ts.
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
} from './request-handlers';

// ---- Main Request Handler ----

async function handleRequest(request: Request): Promise<Response> {
  const route = routeConfig(request);
  const upstream = getUpstream(request, route.upstream);
  const fmt = upstreamFormat(request);

  // Body size gate — applies to all POST requests
  if (request.method === 'POST') {
    const sizeResp = await checkBodySize(request);
    if (sizeResp) return sizeResp;
  }

  // Anthropic → OpenAI
  if (route.path === '/v1/messages' && request.method === 'POST') {
    return handleAnthropicToOpenAI(request, { path: route.path, modelOverride: route.modelOverride, upstream }, fmt);
  }

  // OpenAI → Anthropic (or pass-through)
  if (route.path === '/v1/chat/completions' && request.method === 'POST') {
    return handleOpenAIChatCompletions(request, { path: route.path, modelOverride: route.modelOverride, upstream }, fmt);
  }

  // Responses API → Chat Completions
  if (route.path === '/v1/responses' && request.method === 'POST') {
    return handleResponsesAPI(request, { path: route.path, modelOverride: route.modelOverride, upstream });
  }

  // Model discovery (with 300s cache)
  if (route.path === '/v1/models' && request.method === 'GET') {
    return handleModelList(request, { path: route.path, modelOverride: route.modelOverride, upstream }, fmt);
  }

  // Root health check (no auth required)
  if (route.path === '/' && request.method === 'GET') {
    return handleHealthCheck(upstream);
  }

  // 404 for unknown paths
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
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
