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
import { VERSION } from './version';

// NOTE: These upstream URLs intentionally do NOT include /v1. Each route handler appends
// the appropriate path segment (e.g., /v1/messages, /chat/completions). This prevents
// double /v1/ when the handler adds its own prefix.
const GO_UPSTREAM = "https://opencode.ai/zen/go";
const ZEN_UPSTREAM = "https://opencode.ai/zen";
const DEFAULT_UPSTREAM = GO_UPSTREAM;
const GO_VISION_MODEL = "qwen3.6-plus";
// /zen upstream's qwen3.6-plus-free promotion ended, so we fall back to mimo-v2.5-free
// (a multimodal model — supports image inputs) which is genuinely free on /zen.
const ZEN_VISION_MODEL = "mimo-v2.5-free";

// Vision-capable models per upstream. Source of truth: .claude/skills/model-registry/SKILL.md
// (section "Vision-Capable Models"). Update both this code and the skill when adding models.
// Conservative: unknown models are treated as NOT vision-capable (safe default — forced override).
// Model names must match exactly what the upstream accepts in the request body model field.
const VISION_CAPABLE_GO = new Set<string>([
  // Anthropic Claude — all current tiers support vision
  "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1",
  "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4",
  "claude-haiku-4-5",
  // Google Gemini
  "gemini-3.5-flash", "gemini-3.1-pro", "gemini-3-flash",
  // OpenAI GPT-5.x (paid variants; nano variants NOT vision-capable and excluded)
  "gpt-5.5", "gpt-5.5-pro",
  "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini",
  "gpt-5.3-codex-spark", "gpt-5.3-codex",
  "gpt-5.2", "gpt-5.2-codex",
  "gpt-5.1", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1-codex-mini",
  "gpt-5", "gpt-5-codex",
  // Qwen
  "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus",
  // Xiaomi mimo
  "mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5-pro", "mimo-v2.5",
  // Other
  "hy3-preview",
]);

// /zen has paid + free models. Free vision-capable models are listed at the bottom.
const VISION_CAPABLE_ZEN = new Set<string>([
  // Same paid models as /go
  "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1",
  "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4",
  "claude-haiku-4-5",
  "gemini-3.5-flash", "gemini-3.1-pro", "gemini-3-flash",
  "gpt-5.5", "gpt-5.5-pro",
  "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini",
  "gpt-5.3-codex-spark", "gpt-5.3-codex",
  "gpt-5.2", "gpt-5.2-codex",
  "gpt-5.1", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1-codex-mini",
  "gpt-5", "gpt-5-codex",
  "qwen3.6-plus", "qwen3.5-plus",
  // Free vision-capable models on /zen
  "mimo-v2.5-free",
]);

/**
 * Selects the vision model for an image-bearing request.
 *
 * If the requested model (from body, or after URL path override) is already
 * vision-capable on the routed upstream, returns it unchanged — no override.
 * Otherwise falls back to the default vision model for the upstream.
 *
 * This avoids pointless overrides when the user explicitly requests a
 * vision-capable model (e.g., claude-sonnet-4-6, qwen3.6-plus), while
 * still routing non-vision requests to a model that can handle images.
 *
 * /zen's upstream rejects unknown model IDs, so we still need the fallback
 * for cases where the user requests a non-vision model on /zen with an image.
 */
function getVisionModel(upstream: string, requestedModel?: string | null): string {
  if (requestedModel) {
    if (upstream.includes("/zen/go") && VISION_CAPABLE_GO.has(requestedModel)) return requestedModel;
    if (upstream.includes("/zen") && VISION_CAPABLE_ZEN.has(requestedModel)) return requestedModel;
  }
  if (upstream.includes("/zen/go")) return GO_VISION_MODEL;
  if (upstream.includes("/zen")) return ZEN_VISION_MODEL;
  return GO_VISION_MODEL;
}

// Regex to match API version prefixes (v1, v2, v3, etc.) — more future-proof than a fixed Set
const API_VERSION_PATTERN = /^v\d+$/;

// Headers forwarded from upstream responses to clients (success and error paths)
const UPSTREAM_FORWARD_HEADERS = [
  "X-Request-Id",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
];
const IS_DEBUG = typeof process !== 'undefined' && process.env?.DEBUG;

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
  if (Array.isArray(messages) && messages.some((msg: any) =>
    Array.isArray(msg.content) && msg.content.some((part: any) => part.type === "image")
  )) return true;
  // Check system prompt (Anthropic format can have image blocks in system as content blocks)
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some((part: any) => part.type === "image");
  }
  return false;
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
  if (Array.isArray(messages) && messages.some((msg: any) => {
    if (typeof msg.content === "string") return false;
    if (Array.isArray(msg.content)) {
      return msg.content.some((part: any) => part.type === "image_url");
    }
    return false;
  })) return true;
  // Check top-level system field (some OpenAI-compatible providers support it with image_url parts)
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some((part: any) => part.type === "image_url");
  }
  return false;
}

/**
 * Single-pass image detection: checks both Anthropic (type: "image") and OpenAI (type: "image_url")
 * formats in one traversal. Used on pass-through paths where body format is assumed but not guaranteed,
 * to avoid double-traversing the message array.
 */
function hasAnyImageInMessages(body: any): boolean {
  // Check messages array
  const messages = body?.messages;
  if (Array.isArray(messages)) {
    const hasInMessages = messages.some((msg: any) => {
      if (typeof msg.content === "string") return false;
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some(
        (part: any) => part.type === "image" || part.type === "image_url"
      );
    });
    if (hasInMessages) return true;
  }
  // Check system prompt (Anthropic format can have image blocks in system)
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some(
      (part: any) => part.type === "image" || part.type === "image_url"
    );
  }
  return false;
}

function upstreamErrorResponse(res: Response, body: string): Response {
  const headers = new Headers();
  for (const name of ["Content-Type", "Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "X-Request-Id", "X-RateLimit-Limit-Requests", "X-RateLimit-Limit-Tokens"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(body, { status: res.status, headers });
}

/**
 * Creates a combined abort signal for upstream streaming requests.
 * Races the client's disconnect signal against a generous 120s timeout.
 * If the client disconnects first, the upstream request is aborted immediately.
 * If the upstream stalls for 120s, the connection is terminated as a safety net.
 */
function createStreamSignal(request: Request): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);
  request.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    controller.abort();
  }, { once: true });
  return controller.signal;
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
function authenticateRequest(request: Request, path: string): { key: string } | { response: Response } {
  const key = extractApiKey(request.headers);
  const err = validateApiKey(key);
  if (err) return { response: authErrorResponse(err, path) };
  // validateApiKey already rejects null/undefined keys; this branch is a defensive fallback
  if (!key) return { response: authErrorResponse({ status: 401, body: { error: { type: "authentication_error", message: "Invalid API key" } } }, path) };
  return { key };
}

/** Fetch with timeout/abort/network-error catch — returns error response on failure. */
async function safeUpstreamFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return new Response(
        JSON.stringify({ error: { type: "upstream_error", message: "Request aborted" } }),
        { status: 499, headers: { "Content-Type": "application/json" } },
      );
    }
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
    const auth = authenticateRequest(request, route.path);
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
        req.model = getVisionModel(upstream, req.model);
      }
      const openaiReq = formatAnthropicToOpenAI(req);
      const upstreamSignal = openaiReq.stream ? createStreamSignal(request) : AbortSignal.timeout(60_000);
      const res = await safeUpstreamFetch(`${upstream}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify(openaiReq),
        signal: upstreamSignal,
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
      const anthRawBody = await request.text();
      let parsedBody: any;
      try { parsedBody = JSON.parse(anthRawBody); } catch {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "Request body contains invalid JSON" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      const anthHasImages = hasAnyImageInMessages(parsedBody);
      const needsAnthMod = !!(route.modelOverride || anthHasImages);
      if (needsAnthMod) {
        if (route.modelOverride) parsedBody.model = route.modelOverride;
        if (anthHasImages) parsedBody.model = getVisionModel(upstream, parsedBody.model);
      }
      const anthBody = needsAnthMod ? JSON.stringify(parsedBody) : anthRawBody;
      const anthIsStreaming = !!(parsedBody?.stream);
      const anthUpstreamSignal = anthIsStreaming ? createStreamSignal(request) : AbortSignal.timeout(60_000);
      const anthPassRes = await safeUpstreamFetch(`${upstream}/v1/messages`, {
        method: "POST",
        headers: anthropicHeaders(request, key),
        body: anthBody,
        signal: anthUpstreamSignal,
      });
      if (!anthPassRes.ok) return upstreamErrorResponse(anthPassRes, await anthPassRes.text());
      return anthPassRes;
    }
  }

  // ====================================================================
  // OpenAI → Anthropic (or pass-through to OpenAI upstream)
  // ====================================================================
  if (route.path === '/v1/chat/completions' && request.method === 'POST') {
    const auth = authenticateRequest(request, route.path);
    if ('response' in auth) return auth.response;
    const key = auth.key;

    if (fmt === "anthropic") {
      // ---- Translate: OpenAI body → Anthropic body ----
      const parsed = await safeJsonBody<any>(request);
      if (!parsed.ok) return parsed.response;
      const req = parsed.data;

      const originalModel = req.model;
      if (route.modelOverride) req.model = route.modelOverride;
      if (hasOpenAIImages(req)) req.model = getVisionModel(upstream, req.model);
      const anthReq = formatOpenAIToAnthropic(req);
      const upstreamSignal = anthReq.stream ? createStreamSignal(request) : AbortSignal.timeout(60_000);
      const res = await safeUpstreamFetch(`${upstream}/v1/messages`, {
        method: "POST",
        headers: anthropicHeaders(request, key),
        body: JSON.stringify(anthReq),
        signal: upstreamSignal,
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
    // Single-pass image detection checks both formats simultaneously.
    const oaiRawBody = await request.text();
    let parsedOaiBody: any;
    try { parsedOaiBody = JSON.parse(oaiRawBody); } catch {
      return new Response(
        JSON.stringify({ error: { type: "invalid_request_error", message: "Request body contains invalid JSON" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const oaiHasImages = hasAnyImageInMessages(parsedOaiBody);
    const needsOaiMod = !!(route.modelOverride || oaiHasImages);
    if (needsOaiMod) {
      if (route.modelOverride) parsedOaiBody.model = route.modelOverride;
      if (oaiHasImages) parsedOaiBody.model = getVisionModel(upstream, parsedOaiBody.model);
    }
    const oaiBody = needsOaiMod ? JSON.stringify(parsedOaiBody) : oaiRawBody;
    const oaiIsStreaming = !!(parsedOaiBody?.stream);
    const oaiUpstreamSignal = oaiIsStreaming ? createStreamSignal(request) : AbortSignal.timeout(60_000);
    const oaiPassRes = await safeUpstreamFetch(`${upstream}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: oaiBody,
      signal: oaiUpstreamSignal,
    });
    if (!oaiPassRes.ok) return upstreamErrorResponse(oaiPassRes, await oaiPassRes.text());
    return oaiPassRes;
  }

  // ====================================================================
  // Responses API → Chat Completions
  // ====================================================================
  if (route.path === '/v1/responses' && request.method === 'POST') {
    const auth = authenticateRequest(request, route.path);
    if ('response' in auth) return auth.response;
    const key = auth.key;

    const parsed = await safeJsonBody<any>(request);
    if (!parsed.ok) return parsed.response;
    const req = parsed.data;

    const originalModel = req.model;
    if (IS_DEBUG) {
      console.log(`[RESPONSES] Incoming model=${req.model}, originalModel=${originalModel}, route.modelOverride=${route.modelOverride}`);
      console.log(`[RESPONSES] Input type=${typeof req.input}, has thinking=${!!req.thinking}`);

      if (Array.isArray(req.input)) {
        for (let ii = 0; ii < req.input.length; ii++) {
          const item = req.input[ii];
          if (item.type === 'message') {
            const contentPreview = Array.isArray(item.content)
              ? item.content.map((p: any) => p.type).join(',')
              : typeof item.content;
            console.log(`[RESPONSES]   input[${ii}] type=${item.type} role=${item.role} content_types=[${contentPreview}]`);
          } else if (item.type === 'reasoning') {
            console.log(`[RESPONSES]   input[${ii}] type=${item.type} reasoning_len=${(item.reasoning_text||'').length}`);
          } else {
            console.log(`[RESPONSES]   input[${ii}] type=${item.type}`);
          }
        }
      } else if (typeof req.input === 'string') {
        console.log(`[RESPONSES]   input string len=${req.input.length}`);
      } else {
        console.log(`[RESPONSES]   input other type=${typeof req.input}`);
      }
    }

    if (route.modelOverride) req.model = route.modelOverride;

    // Vision model override must be checked BEFORE DeepSeek thinking injection,
    // to avoid injecting "thinking" on a model that is no longer a DeepSeek model
    if (hasResponsesImages(req)) {
      req.model = getVisionModel(upstream, req.model);
    }

    // DeepSeek compatibility: auto-inject thinking for reasoning models
    if (req.model?.startsWith('deepseek-') && !req.thinking) {
      req.thinking = { type: "enabled" };
    }

    const chatReq = formatResponsesToChatCompletions(req);
    if (IS_DEBUG) {
      console.log(`[RESPONSES] ChatReq model=${chatReq.model}, messages count=${chatReq.messages?.length}`);
      for (let mi = 0; mi < (chatReq.messages?.length || 0); mi++) {
        const m = chatReq.messages[mi];
        const preview = m.role === 'user' ? `"${(m.content || '').slice(0, 120)}"`
          : m.role === 'assistant' ? `len=${(m.content || '').length} reasoning=${!!m.reasoning_content} tool_calls=${(m.tool_calls||[]).length}`
          : `"${(m.content || '').slice(0, 80)}"`;
        console.log(`[RESPONSES]   msg[${mi}] role=${m.role} content=${preview}`);
      }
    }
    const upstreamSignal = chatReq.stream ? createStreamSignal(request) : AbortSignal.timeout(60_000);
    const upstreamRes = await safeUpstreamFetch(`${upstream}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify(chatReq),
      signal: upstreamSignal,
    });
    if (!upstreamRes.ok) return upstreamErrorResponse(upstreamRes, await upstreamRes.text());

    if (chatReq.stream) {
      if (IS_DEBUG) console.log(`[RESPONSES] Streaming response`);
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
    if (IS_DEBUG) {
      console.log(`[RESPONSES] Upstream response keys=${Object.keys(data).join(',')}`);
      console.log(`[RESPONSES] Upstream reasoning_content=${!!data.choices?.[0]?.message?.reasoning_content}`);
      const upstreamContent = data.choices?.[0]?.message?.content || '';
      console.log(`[RESPONSES] Upstream content preview=${upstreamContent.slice(0, 200)}`);
      if (upstreamContent.includes('<think>')) {
        console.log(`[RESPONSES] ⚠️  FOUND <think> tags in upstream content!`);
      }
    }

    const respData = formatChatCompletionsToResponses(data, originalModel);
    if (IS_DEBUG) {
      console.log(`[RESPONSES] Translated output item types=${respData.output?.map((o: any) => o.type).join(',')}`);
      const textOutput = respData.output?.find((o: any) => o.type === 'message')?.content?.[0]?.text || '';
      if (textOutput.includes('<think>')) {
        console.log(`[RESPONSES] ⚠️  FOUND <think> tags in translated output text!`);
      }
    }

    const respHeaders = new Headers({ "Content-Type": "application/json" });
    forwardUpstreamHeaders(respHeaders, upstreamRes);
    return new Response(JSON.stringify(respData), {
      headers: respHeaders,
    });
  }

  // ====================================================================
  // Model discovery (with Cloudflare Cache API for 300s TTL)
  // ====================================================================
  if (route.path === '/v1/models' && request.method === 'GET') {
    const auth = authenticateRequest(request, route.path);
    if ('response' in auth) return auth.response;
    const key = auth.key;

    // Compute cache key from upstream + format (auth-independent, URL-only)
    const cacheRequest = new Request(`${upstream}/v1/models?fmt=${fmt}`, { method: "GET" });
    const modelCache = typeof caches !== "undefined" ? caches.default : null;
    const cached = modelCache ? await modelCache.match(cacheRequest) : null;
    if (cached) return cached;

    const res = fmt === "anthropic"
      ? await safeUpstreamFetch(`${upstream}/v1/models`, {
          method: "GET",
          headers: anthropicHeaders(request, key),
          signal: AbortSignal.timeout(10_000),
        })
      : await safeUpstreamFetch(`${upstream}/v1/models`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
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
      (async () => { try { await modelCache.put(cacheRequest, response.clone()); } catch (e) { console.error('modelCache.put failed:', e); } })();
    }
    return response;
  }

  // ====================================================================
  // Root path: health-check info (no auth required)
  // ====================================================================
  if (route.path === '/' && request.method === 'GET') {
    return new Response(JSON.stringify({
      name: "opencode-cowork-proxy",
      version: VERSION,
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
