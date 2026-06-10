/**
 * Route-specific request handlers extracted from index.ts.
 *
 * WHEN TO READ THIS FILE: You are debugging a routing or translation bug,
 * adding a new API endpoint, or changing how requests flow through the proxy.
 *
 * Each handler is a focused function handling one API route branch.
 * They share no state — all dependencies are passed as parameters.
 *
 * HANDLER MAP:
 *   handleAnthropicToOpenAI      — POST /v1/messages (Anthropic client)
 *   handleOpenAIChatCompletions   — POST /v1/chat/completions (OpenAI client)
 *   handleResponsesAPI           — POST /v1/responses (Responses API client)
 *   handleModelList              — GET /v1/models (model discovery)
 *   handleHealthCheck            — GET / (health check, no auth)
 *
 * IMPORTANT: Every handler follows the same phase sequence:
 *   authenticate → parse body → model override chain → translate → upstream fetch → translate response
 * The model override chain order (URL→vision→thinking) is critical — see CLAUDE.md pitfalls.
 *
 * NOTE: handleAnthropicToOpenAI and handleOpenAIChatCompletions have near-identical
 * structure with different variable names. This is intentional — they handle
 * different body formats and translation functions. Do not merge them.
 */

import {
  formatAnthropicToOpenAI,
  formatOpenAIToAnthropic,
  formatResponsesToChatCompletions,
  toAnthropicResponse,
  toOpenAIResponse,
  formatChatCompletionsToResponses,
  streamAnthropicToOpenAI,
  streamOpenAIToAnthropic,
  streamChatCompletionsToResponses,
} from './translate';
import { VERSION } from './version';
import { IS_DEBUG, START_TIME, GO_UPSTREAM, ZEN_UPSTREAM, UPSTREAM_FORWARD_HEADERS, MODEL_CACHE_TTL, DEFAULT_TIMEOUT, MODEL_LIST_TIMEOUT } from './config';
import { getVisionModel, hasImages, hasOpenAIImages, hasResponsesImages, hasAnyImageInMessages, rawBodyMayHaveImages } from './vision';
import { authenticateRequest, safeUpstreamFetch, safeJsonBody, createStreamSignal, anthropicHeaders, upstreamErrorResponse, forwardUpstreamHeaders, jsonResponse, formatUptime } from './request';

interface RouteInfo {
  path: string;
  modelOverride?: string | null;
  upstream: string;
}

/**
 * Anthropic Messages → OpenAI Chat Completions (or pass-through if fmt === 'anthropic').
 */
export async function handleAnthropicToOpenAI(
  request: Request,
  route: RouteInfo,
  fmt: string,
): Promise<Response> {
  const auth = authenticateRequest(request, route.path);
  if ('response' in auth) return auth.response;
  const { key } = auth;
  const upstream = route.upstream;

  if (fmt === "openai") {
    // ---- Translate: Anthropic body → OpenAI body ----
    const parsed = await safeJsonBody<Record<string, unknown>>(request);
    if (!parsed.ok) return parsed.response;
    const req = parsed.data;

    const originalModel = req.model as string | undefined;
    if (route.modelOverride) req.model = route.modelOverride;
    if (hasImages(req)) {
      req.model = getVisionModel(upstream, req.model as string | null | undefined);
    }
    const openaiReq = formatAnthropicToOpenAI(req);
    const upstreamSignal = (openaiReq as Record<string, unknown>).stream ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
    const res = await safeUpstreamFetch(`${upstream}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify(openaiReq),
      signal: upstreamSignal,
    });
    if (!res.ok) return upstreamErrorResponse(res, await res.text());

    if ((openaiReq as Record<string, unknown>).stream) {
      const streamHeaders = new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      forwardUpstreamHeaders(streamHeaders, res);
      return new Response(streamOpenAIToAnthropic(res.body as ReadableStream, originalModel ?? 'unknown'), {
        headers: streamHeaders,
      });
    }
    const data: unknown = await res.json();
    const upstreamHeaders: Record<string, string> = {};
    for (const name of UPSTREAM_FORWARD_HEADERS) {
      const value = res.headers.get(name);
      if (value) upstreamHeaders[name] = value;
    }
    return jsonResponse(request, toAnthropicResponse(data as Record<string, unknown>, originalModel ?? 'unknown'), upstreamHeaders);
  }

  // ---- Pass-through: send Anthropic body as-is to Anthropic upstream ----
  const anthRawBody = await request.text();
  let parsedBody: Record<string, unknown>;
  try { parsedBody = JSON.parse(anthRawBody) as Record<string, unknown>; } catch {
    return new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "Request body contains invalid JSON" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Fast path: if no model override AND no image markers in raw string
  if (!route.modelOverride && !rawBodyMayHaveImages(anthRawBody)) {
    const anthIsStreaming = !!(parsedBody?.stream);
    const anthUpstreamSignal = anthIsStreaming ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
    const anthPassRes = await safeUpstreamFetch(`${upstream}/v1/messages`, {
      method: "POST",
      headers: anthropicHeaders(request, key),
      body: anthRawBody,
      signal: anthUpstreamSignal,
    });
    if (!anthPassRes.ok) return upstreamErrorResponse(anthPassRes, await anthPassRes.text());
    return anthPassRes;
  }

  // Slow path: need to check for images or apply model override
  const anthHasImages = hasAnyImageInMessages(parsedBody);
  const needsAnthMod = !!(route.modelOverride || anthHasImages);
  if (needsAnthMod) {
    if (route.modelOverride) parsedBody.model = route.modelOverride;
    if (anthHasImages) parsedBody.model = getVisionModel(upstream, parsedBody.model as string | null | undefined);
  }
  const anthBody = needsAnthMod ? JSON.stringify(parsedBody) : anthRawBody;
  const anthIsStreaming = !!(parsedBody?.stream);
  const anthUpstreamSignal = anthIsStreaming ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
  const anthPassRes = await safeUpstreamFetch(`${upstream}/v1/messages`, {
    method: "POST",
    headers: anthropicHeaders(request, key),
    body: anthBody,
    signal: anthUpstreamSignal,
  });
  if (!anthPassRes.ok) return upstreamErrorResponse(anthPassRes, await anthPassRes.text());
  return anthPassRes;
}

/**
 * OpenAI Chat Completions → Anthropic Messages (or pass-through to OpenAI upstream).
 */
export async function handleOpenAIChatCompletions(
  request: Request,
  route: RouteInfo,
  fmt: string,
): Promise<Response> {
  const auth = authenticateRequest(request, route.path);
  if ('response' in auth) return auth.response;
  const { key } = auth;
  const upstream = route.upstream;

  if (fmt === "anthropic") {
    // ---- Translate: OpenAI body → Anthropic body ----
    const parsed = await safeJsonBody<Record<string, unknown>>(request);
    if (!parsed.ok) return parsed.response;
    const req = parsed.data;

    const originalModel = req.model;
    if (route.modelOverride) req.model = route.modelOverride;
    if (hasOpenAIImages(req)) req.model = getVisionModel(upstream, req.model);
    const anthReq = formatOpenAIToAnthropic(req);
    const upstreamSignal = anthReq.stream ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
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
    const data: Record<string, unknown> = await res.json();
    const upstreamHeaders: Record<string, string> = {};
    for (const name of UPSTREAM_FORWARD_HEADERS) {
      const value = res.headers.get(name);
      if (value) upstreamHeaders[name] = value;
    }
    return jsonResponse(request, toOpenAIResponse(data, originalModel), upstreamHeaders);
  }

  // ---- Pass-through: send OpenAI body as-is to OpenAI upstream ----
  const oaiRawBody = await request.text();
  let parsedOaiBody: Record<string, unknown>;
  try { parsedOaiBody = JSON.parse(oaiRawBody) as Record<string, unknown>; } catch {
    return new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "Request body contains invalid JSON" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Fast path: if no model override AND no image markers in raw string
  if (!route.modelOverride && !rawBodyMayHaveImages(oaiRawBody)) {
    const oaiIsStreaming = !!(parsedOaiBody?.stream);
    const oaiUpstreamSignal = oaiIsStreaming ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
    const oaiPassRes = await safeUpstreamFetch(`${upstream}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: oaiRawBody,
      signal: oaiUpstreamSignal,
    });
    if (!oaiPassRes.ok) return upstreamErrorResponse(oaiPassRes, await oaiPassRes.text());
    return oaiPassRes;
  }

  // Slow path: need to check for images or apply model override
  const oaiHasImages = hasAnyImageInMessages(parsedOaiBody);
  const needsOaiMod = !!(route.modelOverride || oaiHasImages);
  if (needsOaiMod) {
    if (route.modelOverride) parsedOaiBody.model = route.modelOverride;
    if (oaiHasImages) parsedOaiBody.model = getVisionModel(upstream, parsedOaiBody.model as string | null | undefined);
  }
  const oaiBody = needsOaiMod ? JSON.stringify(parsedOaiBody) : oaiRawBody;
  const oaiIsStreaming = !!(parsedOaiBody?.stream);
  const oaiUpstreamSignal = oaiIsStreaming ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
  const oaiPassRes = await safeUpstreamFetch(`${upstream}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: oaiBody,
    signal: oaiUpstreamSignal,
  });
  if (!oaiPassRes.ok) return upstreamErrorResponse(oaiPassRes, await oaiPassRes.text());
  return oaiPassRes;
}

/**
 * OpenAI Responses API → Chat Completions (one-directional).
 */
export async function handleResponsesAPI(
  request: Request,
  route: RouteInfo,
): Promise<Response> {
  const auth = authenticateRequest(request, route.path);
  if ('response' in auth) return auth.response;
  const { key } = auth;
  const upstream = route.upstream;

  const parsed = await safeJsonBody<Record<string, unknown>>(request);
  if (!parsed.ok) return parsed.response;
  const req = parsed.data;

  const originalModel = req.model;
  if (IS_DEBUG) {
    console.log(`[RESPONSES] Incoming model=${req.model}, originalModel=${originalModel}, route.modelOverride=${route.modelOverride}`);
    console.log(`[RESPONSES] Input type=${typeof req.input}, has thinking=${!!req.thinking}`);

    if (Array.isArray(req.input)) {
      for (let ii = 0; ii < req.input.length; ii++) {
        const item = req.input[ii] as Record<string, unknown>;
        if (item.type === 'message') {
          const contentPreview = Array.isArray(item.content)
            ? (item.content as Record<string, unknown>[]).map((p) => p.type).join(',')
            : typeof item.content;
          console.log(`[RESPONSES]   input[${ii}] type=${item.type} role=${item.role} content_types=[${contentPreview}]`);
        } else if (item.type === 'reasoning') {
          console.log(`[RESPONSES]   input[${ii}] type=${item.type} reasoning_len=${String(item.reasoning_text || '').length}`);
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

  // Vision model override before DeepSeek thinking injection
  if (hasResponsesImages(req)) {
    req.model = getVisionModel(upstream, req.model);
  }

  // DeepSeek: auto-inject thinking for reasoning models
  if (req.model?.startsWith('deepseek-') && !req.thinking) {
    req.thinking = { type: "enabled" };
  }

  const chatReq = formatResponsesToChatCompletions(req);
  if (IS_DEBUG) {
    const { model, messages } = chatReq;
    console.log(`[RESPONSES] ChatReq model=${model}, messages count=${(messages as Array<Record<string, unknown>> | undefined)?.length}`);
    const msgs = (messages as Array<Record<string, unknown>> | undefined) || [];
    for (let mi = 0; mi < msgs.length; mi++) {
      const m = msgs[mi];
      const preview = m.role === 'user' ? `"${String(m.content || '').slice(0, 120)}"`
        : m.role === 'assistant' ? `len=${String(m.content || '').length} reasoning=${!!m.reasoning_content} tool_calls=${((m.tool_calls || []) as unknown[]).length}`
        : `"${String(m.content || '').slice(0, 80)}"`;
      console.log(`[RESPONSES]   msg[${mi}] role=${m.role} content=${preview}`);
    }
  }
  const upstreamSignal = chatReq.stream ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
  const upstreamRes = await safeUpstreamFetch(`${upstream}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
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

  const data: Record<string, unknown> = await upstreamRes.json();
  if (IS_DEBUG) {
    console.log(`[RESPONSES] Upstream response keys=${Object.keys(data).join(',')}`);
    const firstChoice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0] as Record<string, unknown> | undefined;
    const firstMsg = firstChoice?.message as Record<string, unknown> | undefined;
    console.log(`[RESPONSES] Upstream reasoning_content=${!!firstMsg?.reasoning_content}`);
    const upstreamContent = String(firstMsg?.content || '');
    console.log(`[RESPONSES] Upstream content preview=${upstreamContent.slice(0, 200)}`);
    if (upstreamContent.includes('<think>')) {
      console.log(`[RESPONSES] ⚠️  FOUND <think> tags in upstream content!`);
    }
  }

  const respData = formatChatCompletionsToResponses(data, originalModel);
  if (IS_DEBUG) {
    const outputItems = (respData.output as Array<Record<string, unknown>> | undefined) || [];
    console.log(`[RESPONSES] Translated output item types=${outputItems.map((o) => o.type).join(',')}`);
    const msgItem = outputItems.find((o) => o.type === 'message') as Record<string, unknown> | undefined;
    const textOutput = String((msgItem?.content as Array<Record<string, unknown>> | undefined)?.[0]?.text || '');
    if (textOutput.includes('<think>')) {
      console.log(`[RESPONSES] ⚠️  FOUND <think> tags in translated output text!`);
    }
  }

  const upstreamHeaders: Record<string, string> = {};
  for (const name of UPSTREAM_FORWARD_HEADERS) {
    const value = upstreamRes.headers.get(name);
    if (value) upstreamHeaders[name] = value;
  }
  return jsonResponse(request, respData, upstreamHeaders);
}

/**
 * Model discovery (with Cloudflare Cache API for 300s TTL).
 */
export async function handleModelList(
  request: Request,
  route: RouteInfo,
  fmt: string,
): Promise<Response> {
  const auth = authenticateRequest(request, route.path);
  if ('response' in auth) return auth.response;
  const { key } = auth;
  const upstream = route.upstream;

  // Compute cache key from upstream + format (auth-independent, URL-only)
  const cacheRequest = new Request(`${upstream}/v1/models?fmt=${fmt}`, { method: "GET" });
  const modelCache = typeof caches !== "undefined" ? caches.default : null;
  const cached = modelCache ? await modelCache.match(cacheRequest) : null;
  if (cached) return cached;

  const res = fmt === "anthropic"
    ? await safeUpstreamFetch(`${upstream}/v1/models`, {
        method: "GET",
        headers: anthropicHeaders(request, key),
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT),
      })
    : await safeUpstreamFetch(`${upstream}/v1/models`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${key}` },
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT),
    });
  if (!res.ok) return upstreamErrorResponse(res, await res.text());

  const body = await res.text();
  const response = new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${MODEL_CACHE_TTL}`,
    },
  });
  // Fire-and-forget cache put (no await to avoid blocking response)
  if (modelCache) {
    (async () => { try { await modelCache.put(cacheRequest, response.clone()); } catch (e) { if (IS_DEBUG) console.error('modelCache.put failed:', e); } })();
  }
  return response;
}

/**
 * Root path: health-check info (no auth required).
 */
export function handleHealthCheck(upstream: string): Response {
  return jsonResponse(new Request('http://localhost/'), {
    name: "opencode-cowork-proxy",
    version: VERSION,
    status: "ok",
    uptime: formatUptime(Math.floor((Date.now() - START_TIME) / 1000)),
    upstream,
    routes: {
      "/go": GO_UPSTREAM,
      "/zen": ZEN_UPSTREAM,
    },
    endpoints: {
      "/v1/messages": "Anthropic Messages API — Claude Desktop / Claude Code",
      "/v1/chat/completions": "OpenAI Chat Completions API — OpenAI SDK",
      "/v1/responses": "OpenAI Responses API — translated to Chat Completions",
      "/v1/models": "Model list — proxied from upstream with 5min cache",
    },
  });
}
