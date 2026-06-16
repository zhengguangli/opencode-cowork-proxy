/**
 * Anthropic Messages → OpenAI Chat Completions (or pass-through if fmt === 'openai').
 *
 * WHEN TO READ THIS FILE: Debugging a translation bug in the Anthropic→OpenAI path,
 * or modifying how Anthropic client requests are processed and forwarded.
 *
 * Two paths:
 *   fmt === "openai"  → Translate Anthropic body → OpenAI body, send to /v1/chat/completions
 *   fmt === "anthropic" → Pass-through or modify Anthropic body, send to /v1/messages
 *
 * IMPORTANT: Model override chain order (URL→vision→thinking) is critical — see docs/ARCHITECTURE.md.
 */

import {
  formatAnthropicToOpenAI,
  toAnthropicResponse,
  streamOpenAIToAnthropic,
} from '../translate';
import { DEFAULT_TIMEOUT, UPSTREAM_FORWARD_HEADERS } from '../config';
import { hasImages, hasAnyImageInMessages, rawBodyMayHaveImages, getVisionModel } from '../vision';
import {
  authenticateRequest,
  safeJsonBody,
  safeUpstreamFetch,
  createStreamSignal,
  anthropicHeaders,
  upstreamErrorResponse,
  forwardUpstreamHeaders,
  jsonResponse,
} from '../request';
import { asRecord } from '../translate/type-guards';
import { RouteInfo } from './shared';

import { compressibleStream } from '../compress';

/**
 * Handle POST /v1/messages — Anthropic client → upstream.
 *
 * When fmt is "openai", translates Anthropic Messages body to OpenAI Chat Completions
 * format and sends to the upstream's /v1/chat/completions endpoint.
 * When fmt is "anthropic", passes through to the upstream's /v1/messages endpoint
 * with optional model override and image detection.
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
    const upstreamSignal = asRecord(openaiReq).stream ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
    const res = await safeUpstreamFetch(`${upstream}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify(openaiReq),
      signal: upstreamSignal,
    });
    if (!res.ok) return upstreamErrorResponse(res, await res.text());

    if (asRecord(openaiReq).stream) {
      const streamHeaders = new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      forwardUpstreamHeaders(streamHeaders, res);
      const compressedResult = compressibleStream(streamOpenAIToAnthropic(res.body as ReadableStream, originalModel ?? 'unknown'), request);
      if (compressedResult.contentEncoding) streamHeaders.set("Content-Encoding", compressedResult.contentEncoding);
      return new Response(compressedResult.stream, {
        headers: streamHeaders,
      });
    }
    const data: unknown = await res.json();
    const upstreamHeaders: Record<string, string> = {};
    for (const name of UPSTREAM_FORWARD_HEADERS) {
      const value = res.headers.get(name);
      if (value) upstreamHeaders[name] = value;
    }
    return jsonResponse(request, toAnthropicResponse(asRecord(data), originalModel ?? 'unknown'), upstreamHeaders);
  }

  // ---- Pass-through: send Anthropic body as-is to Anthropic upstream ----
  const anthRawBody = await request.text();
  let parsedBody: Record<string, unknown>;
  try { parsedBody = asRecord(JSON.parse(anthRawBody)); } catch {
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
    if (anthIsStreaming) {
      const ptHeaders = new Headers(anthPassRes.headers);
      const compressed = compressibleStream(anthPassRes.body as ReadableStream, request);
      if (compressed.contentEncoding) ptHeaders.set("Content-Encoding", compressed.contentEncoding);
      return new Response(compressed.stream, { headers: ptHeaders });
    }
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
  if (anthIsStreaming) {
    const ptHeaders = new Headers(anthPassRes.headers);
    const compressed = compressibleStream(anthPassRes.body as ReadableStream, request);
    if (compressed.contentEncoding) ptHeaders.set("Content-Encoding", compressed.contentEncoding);
    return new Response(compressed.stream, { headers: ptHeaders });
  }
  return anthPassRes;
}
