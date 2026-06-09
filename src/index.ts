import { Hono } from 'hono';
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
import { IS_DEBUG, START_TIME, GO_UPSTREAM, ZEN_UPSTREAM, UPSTREAM_FORWARD_HEADERS } from './config';
import { routeConfig, getUpstream, upstreamFormat } from './routing';
import { getVisionModel, hasImages, hasOpenAIImages, hasResponsesImages, hasAnyImageInMessages, rawBodyMayHaveImages } from './vision';
import { authenticateRequest, safeUpstreamFetch, safeJsonBody, createStreamSignal, anthropicHeaders, upstreamErrorResponse, forwardUpstreamHeaders, jsonResponse, formatUptime } from './request';

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
      const parsed = await safeJsonBody<Record<string, unknown>>(request);
      if (!parsed.ok) return parsed.response;
      const req = parsed.data as Record<string, unknown>;

      const originalModel = req.model as string | undefined;
      if (route.modelOverride) req.model = route.modelOverride;
      if (hasImages(req)) {
        req.model = getVisionModel(upstream, req.model as string | null | undefined);
      }
      const openaiReq = formatAnthropicToOpenAI(req);
      const upstreamSignal = (openaiReq as Record<string, unknown>).stream ? createStreamSignal(request) : AbortSignal.timeout(60_000);
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

      if ((openaiReq as Record<string, unknown>).stream) {
        const streamHeaders = new Headers({
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        forwardUpstreamHeaders(streamHeaders, res);
        return new Response(streamOpenAIToAnthropic(res.body as ReadableStream, originalModel as string), {
          headers: streamHeaders,
        });
      }
      const data: unknown = await res.json();
      const upstreamHeaders: Record<string, string> = {};
      for (const name of UPSTREAM_FORWARD_HEADERS) {
        const value = res.headers.get(name);
        if (value) upstreamHeaders[name] = value;
      }
      return jsonResponse(request, toAnthropicResponse(data, originalModel), upstreamHeaders);
    } else {
      // ---- Pass-through: send Anthropic body as-is to Anthropic upstream ----
      const anthRawBody = await request.text();
      let parsedBody: unknown;
      try { parsedBody = JSON.parse(anthRawBody); } catch {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "Request body contains invalid JSON" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Fast path: if no model override AND no image markers in raw string,
      // skip the hasAnyImageInMessages traversal (expensive message array walk).
      if (!route.modelOverride && !rawBodyMayHaveImages(anthRawBody)) {
        const anthIsStreaming = !!(parsedBody?.stream);
        const anthUpstreamSignal = anthIsStreaming ? createStreamSignal(request) : AbortSignal.timeout(60_000);
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
      const upstreamHeaders: Record<string, string> = {};
      for (const name of UPSTREAM_FORWARD_HEADERS) {
        const value = res.headers.get(name);
        if (value) upstreamHeaders[name] = value;
      }
      return jsonResponse(request, toOpenAIResponse(data, originalModel), upstreamHeaders);
    }

    // ---- Pass-through: send OpenAI body as-is to OpenAI upstream ----
    const oaiRawBody = await request.text();
    let parsedOaiBody: any;
    try { parsedOaiBody = JSON.parse(oaiRawBody); } catch {
      return new Response(
        JSON.stringify({ error: { type: "invalid_request_error", message: "Request body contains invalid JSON" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Fast path: if no model override AND no image markers in raw string,
    // skip the hasAnyImageInMessages traversal (expensive message array walk).
    if (!route.modelOverride && !rawBodyMayHaveImages(oaiRawBody)) {
      const oaiIsStreaming = !!(parsedOaiBody?.stream);
      const oaiUpstreamSignal = oaiIsStreaming ? createStreamSignal(request) : AbortSignal.timeout(60_000);
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

    const upstreamHeaders: Record<string, string> = {};
    for (const name of UPSTREAM_FORWARD_HEADERS) {
      const value = upstreamRes.headers.get(name);
      if (value) upstreamHeaders[name] = value;
    }
    return jsonResponse(request, respData, upstreamHeaders);
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
    return jsonResponse(request, {
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
