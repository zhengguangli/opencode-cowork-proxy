import { Hono } from 'hono';
import { extractApiKey, validateApiKey, authErrorResponse } from './auth';
import { formatAnthropicToOpenAI } from './translate/request/anthropic-to-openai';
import { formatOpenAIToAnthropic } from './translate/request/openai-to-anthropic';
import { formatOpenAIToAnthropic as toAnthropicResponse } from './translate/response/openai-to-anthropic';
import { formatAnthropicToOpenAI as toOpenAIResponse } from './translate/response/anthropic-to-openai';
import { streamOpenAIToAnthropic } from './translate/stream/openai-to-anthropic';
import { streamAnthropicToOpenAI } from './translate/stream/anthropic-to-openai';
import { formatResponsesToChatCompletions } from './translate/request/responses-to-chat-completions';
import { formatChatCompletionsToResponses } from './translate/response/chat-completions-to-responses';
import { streamChatCompletionsToResponses } from './translate/stream/chat-completions-to-responses';

const GO_UPSTREAM = "https://opencode.ai/zen/go/v1";
const ZEN_UPSTREAM = "https://opencode.ai/zen/v1";
const DEFAULT_UPSTREAM = GO_UPSTREAM;
const VISION_MODEL = "qwen3.6-plus";

// Regex to match API version prefixes (v1, v2, v3, etc.) — more future-proof than a fixed Set
const API_VERSION_PATTERN = /^v\d+$/;

// Headers forwarded from upstream responses to clients (success and error paths)
const UPSTREAM_FORWARD_HEADERS = [
  "X-Request-Id",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
];

type RouteConfig = {
  path: string;
  upstream: string;
  modelOverride: string | null;
};

function stripPrefix(path: string, prefix: string): string | null {
  if (path === prefix) return "/";
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
  return null;
}

function extractModelSegment(path: string): { path: string; model: string | null } {
  const segments = path.replace(/^\/+/, '').split('/');
  if (segments.length > 0 && segments[0] && !API_VERSION_PATTERN.test(segments[0])) {
    return { path: '/' + segments.slice(1).join('/'), model: segments[0] };
  }
  return { path, model: null };
}

function routeConfig(request: Request): RouteConfig {
  const path = new URL(request.url).pathname;
  const goPath = stripPrefix(path, "/go");
  if (goPath) {
    const { path: remaining, model } = extractModelSegment(goPath);
    return { path: remaining, upstream: GO_UPSTREAM, modelOverride: model };
  }

  const zenPath = stripPrefix(path, "/zen");
  if (zenPath) {
    const { path: remaining, model } = extractModelSegment(zenPath);
    return { path: remaining, upstream: ZEN_UPSTREAM, modelOverride: model };
  }

  const { path: remaining, model } = extractModelSegment(path);
  return { path: remaining, upstream: DEFAULT_UPSTREAM, modelOverride: model };
}

function getUpstream(request: Request, routeUpstream: string): string {
  // Trim whitespace and validate URL to avoid passing malformed URLs to fetch()
  const header = request.headers.get("X-Upstream-Url")?.trim();
  if (header) {
    try { new URL(header); return header; }
    catch { /* invalid URL — fall through to configured upstream */ }
  }
  return routeUpstream;
}

function upstreamFormat(request: Request): "openai" | "anthropic" {
  const fmt = (request.headers.get("X-Upstream-Format") || "openai").toLowerCase();
  return fmt === "anthropic" ? "anthropic" : "openai";
}

function anthropicHeaders(request: Request, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": key,
    "Anthropic-Version": request.headers.get("Anthropic-Version") || "2023-06-01",
  };
  const beta = request.headers.get("Anthropic-Beta");
  if (beta) headers["Anthropic-Beta"] = beta;
  return headers;
}

function hasImages(body: any): boolean {
  // Checks Anthropic-format content blocks (type: "image") — used on /v1/messages path
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((msg: any) =>
    Array.isArray(msg.content) && msg.content.some((part: any) => part.type === "image")
  );
}

function hasResponsesImages(body: any): boolean {
  // Checks Responses API format (type: "input_image" or "image_url") — used on /v1/responses path
  const input = body?.input;
  if (!Array.isArray(input)) return false;
  return input.some((item: any) =>
    item.type === "message" && Array.isArray(item.content) &&
    item.content.some((part: any) => part.type === "input_image" || part.type === "image_url")
  );
}

function hasOpenAIImages(body: any): boolean {
  // Checks OpenAI-format content parts (type: "image_url") — used on /v1/chat/completions path
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((msg: any) => {
    if (typeof msg.content === "string") return false;
    if (Array.isArray(msg.content)) {
      return msg.content.some((part: any) => part.type === "image_url");
    }
    return false;
  });
}

function upstreamErrorResponse(res: Response, body: string): Response {
  const headers = new Headers();
  for (const name of ["Content-Type", "Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "X-Request-Id", "X-RateLimit-Limit-Requests", "X-RateLimit-Limit-Tokens"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(body, { status: res.status, headers });
}

// ---- Shared Helpers ----

/** Safe JSON body parser — returns a 400 error on malformed body. */
async function safeJsonBody<T>(request: Request): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  try {
    const data = await request.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid JSON body" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
}

/** Authenticate request and return confirmed non-null API key, or an auth error response. */
function authenticateRequest(request: Request): { key: string } | { response: Response } {
  const key = extractApiKey(request.headers);
  const err = validateApiKey(key);
  if (err) return { response: authErrorResponse(err) };
  if (!key) return { response: authErrorResponse({ status: 401, body: { error: { type: "authentication_error", message: "Invalid API key" } } }) };
  return { key };
}

/** Fetch with network-error catch — returns a 502 response if upstream is unreachable. */
async function safeUpstreamFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    return new Response(
      JSON.stringify({ error: { type: "upstream_error", message: "Upstream unreachable" } }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}

/** Forward select upstream headers (X-Request-Id, rate-limit info) onto the response. */
function forwardUpstreamHeaders(target: Headers, source: Response): void {
  for (const name of UPSTREAM_FORWARD_HEADERS) {
    const value = source.headers.get(name);
    if (value) target.set(name, value);
  }
}

// ---- Main Request Handler ----

async function handleRequest(request: Request): Promise<Response> {
  const route = routeConfig(request);
  const upstream = getUpstream(request, route.upstream);
  const fmt = upstreamFormat(request);

  // ====================================================================
  // Anthropic → OpenAI (Claude Desktop/Cowork → any OpenAI-compatible API)
  // ====================================================================
  if (route.path === '/v1/messages' && request.method === 'POST') {
    const auth = authenticateRequest(request);
    if ('response' in auth) return auth.response;
    const key = auth.key;

    if (fmt === "openai") {
      // ---- Translate: Anthropic body → OpenAI body ----
      const parsed = await safeJsonBody<any>(request);
      if (!parsed.ok) return parsed.response;
      const req = parsed.data;

      const originalModel = req.model;
      if (route.modelOverride) req.model = route.modelOverride;
      if (hasImages(req)) {
        req.model = VISION_MODEL;
      }
      const openaiReq = formatAnthropicToOpenAI(req);
      const res = await safeUpstreamFetch(`${upstream}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify(openaiReq),
      });
      if (!res.ok) return upstreamErrorResponse(res, await res.text());

      if (openaiReq.stream) {
        const streamHeaders = new Headers({
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        forwardUpstreamHeaders(streamHeaders, res);
        return new Response(streamOpenAIToAnthropic(res.body as ReadableStream, originalModel), {
          headers: streamHeaders,
        });
      }
      const data: any = await res.json();
      const respHeaders = new Headers({ "Content-Type": "application/json" });
      forwardUpstreamHeaders(respHeaders, res);
      return new Response(JSON.stringify(toAnthropicResponse(data, originalModel)), {
        headers: respHeaders,
      });
    } else {
      // ---- Pass-through: send Anthropic body as-is to Anthropic upstream ----
      // Image detection uses hasImages() which checks Anthropic-format type: "image"
      const parsed = await safeJsonBody<any>(request);
      if (!parsed.ok) return parsed.response;
      const anthReqJson = parsed.data;

      if (route.modelOverride) anthReqJson.model = route.modelOverride;
      if (hasImages(anthReqJson)) anthReqJson.model = VISION_MODEL;
      const anthPassRes = await safeUpstreamFetch(`${upstream}/v1/messages`, {
        method: "POST",
        headers: anthropicHeaders(request, key),
        body: JSON.stringify(anthReqJson),
      });
      if (!anthPassRes.ok) return upstreamErrorResponse(anthPassRes, await anthPassRes.text());
      return anthPassRes;
    }
  }

  // ====================================================================
  // OpenAI → Anthropic (or pass-through to OpenAI upstream)
  // ====================================================================
  if (route.path === '/v1/chat/completions' && request.method === 'POST') {
    const auth = authenticateRequest(request);
    if ('response' in auth) return auth.response;
    const key = auth.key;

    if (fmt === "anthropic") {
      // ---- Translate: OpenAI body → Anthropic body ----
      const parsed = await safeJsonBody<any>(request);
      if (!parsed.ok) return parsed.response;
      const req = parsed.data;

      const originalModel = req.model;
      if (route.modelOverride) req.model = route.modelOverride;
      if (hasOpenAIImages(req)) req.model = VISION_MODEL;
      const anthReq = formatOpenAIToAnthropic(req);
      const res = await safeUpstreamFetch(`${upstream}/v1/messages`, {
        method: "POST",
        headers: anthropicHeaders(request, key),
        body: JSON.stringify(anthReq),
      });
      if (!res.ok) return upstreamErrorResponse(res, await res.text());

      if (anthReq.stream) {
        const streamHeaders = new Headers({
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        forwardUpstreamHeaders(streamHeaders, res);
        return new Response(streamAnthropicToOpenAI(res.body as ReadableStream, originalModel), {
          headers: streamHeaders,
        });
      }
      const data: any = await res.json();
      const respHeaders = new Headers({ "Content-Type": "application/json" });
      forwardUpstreamHeaders(respHeaders, res);
      return new Response(JSON.stringify(toOpenAIResponse(data, originalModel)), {
        headers: respHeaders,
      });
    }

    // ---- Pass-through: send OpenAI body as-is to OpenAI upstream ----
    // Image detection uses hasOpenAIImages() which checks OpenAI-format type: "image_url"
    const parsed = await safeJsonBody<any>(request);
    if (!parsed.ok) return parsed.response;
    const oaiReqJson = parsed.data;

    if (route.modelOverride) oaiReqJson.model = route.modelOverride;
    if (hasOpenAIImages(oaiReqJson)) oaiReqJson.model = VISION_MODEL;
    const oaiPassRes = await safeUpstreamFetch(`${upstream}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify(oaiReqJson),
    });
    if (!oaiPassRes.ok) return upstreamErrorResponse(oaiPassRes, await oaiPassRes.text());
    return oaiPassRes;
  }

  // ====================================================================
  // Responses API → Chat Completions
  // ====================================================================
  if (route.path === '/v1/responses' && request.method === 'POST') {
    const auth = authenticateRequest(request);
    if ('response' in auth) return auth.response;
    const key = auth.key;

    const parsed = await safeJsonBody<any>(request);
    if (!parsed.ok) return parsed.response;
    const req = parsed.data;

    const originalModel = req.model;
    if (route.modelOverride) req.model = route.modelOverride;

    // Vision model override must be checked BEFORE DeepSeek thinking injection,
    // to avoid injecting "thinking" on a model that is no longer a DeepSeek model
    if (hasResponsesImages(req)) {
      req.model = VISION_MODEL;
    }

    // DeepSeek compatibility: auto-inject thinking for reasoning models
    if (req.model?.startsWith('deepseek-') && !req.thinking) {
      req.thinking = { type: "enabled" };
    }

    const chatReq = formatResponsesToChatCompletions(req);
    const upstreamRes = await safeUpstreamFetch(`${upstream}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify(chatReq),
    });
    if (!upstreamRes.ok) return upstreamErrorResponse(upstreamRes, await upstreamRes.text());

    if (chatReq.stream) {
      const streamHeaders = new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      forwardUpstreamHeaders(streamHeaders, upstreamRes);
      return new Response(streamChatCompletionsToResponses(upstreamRes.body as ReadableStream, originalModel), {
        headers: streamHeaders,
      });
    }

    const data: any = await upstreamRes.json();
    const respHeaders = new Headers({ "Content-Type": "application/json" });
    forwardUpstreamHeaders(respHeaders, upstreamRes);
    return new Response(JSON.stringify(formatChatCompletionsToResponses(data, originalModel)), {
      headers: respHeaders,
    });
  }

  // ====================================================================
  // Model discovery (with Cloudflare Cache API for 300s TTL)
  // ====================================================================
  if (route.path === '/v1/models' && request.method === 'GET') {
    const auth = authenticateRequest(request);
    if ('response' in auth) return auth.response;
    const key = auth.key;

    // Compute cache key from upstream + format (auth-independent, URL-only)
    const cacheRequest = new Request(`${upstream}/models?fmt=${fmt}`, { method: "GET" });
    const modelCache = typeof caches !== "undefined" ? caches.default : null;
    const cached = modelCache ? await modelCache.match(cacheRequest) : null;
    if (cached) return cached;

    const res = fmt === "anthropic"
      ? await safeUpstreamFetch(`${upstream}/v1/models`, {
          method: "GET",
          headers: anthropicHeaders(request, key),
        })
      : await safeUpstreamFetch(`${upstream}/models`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${key}` },
      });
    if (!res.ok) return upstreamErrorResponse(res, await res.text());

    const body = await res.text();
    const response = new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
    // Fire-and-forget cache put (no await to avoid blocking response)
    if (modelCache) {
      (async () => { try { await modelCache.put(cacheRequest, response.clone()); } catch {} })();
    }
    return response;
  }

  // ====================================================================
  // Root path: health-check info (no auth required)
  // ====================================================================
  if (route.path === '/' && request.method === 'GET') {
    return new Response(JSON.stringify({
      name: "opencode-cowork-proxy",
      upstream,
      routes: {
        "/go": GO_UPSTREAM,
        "/zen": ZEN_UPSTREAM,
      },
      endpoints: {
        "/v1/messages": "Anthropic → upstream (translated if upstream=openai)",
        "/v1/chat/completions": "OpenAI → upstream (translated if upstream=anthropic)",
        "/v1/responses": "OpenAI Responses API → upstream Chat Completions",
        "/v1/models": "Model discovery proxy",
      },
    }, null, 2), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
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
