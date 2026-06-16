/**
 * OpenAI Chat Completions → Anthropic Messages (or pass-through to OpenAI upstream).
 *
 * WHEN TO READ THIS FILE: Debugging a translation bug in the OpenAI→Anthropic path,
 * or modifying how OpenAI SDK clients' requests are processed and forwarded.
 *
 * Two paths:
 *   fmt === "anthropic" → Translate OpenAI body → Anthropic body, send to /v1/messages
 *   fmt !== "anthropic" → Pass-through or modify OpenAI body, send to /v1/chat/completions
 *
 * IMPORTANT: Model override chain order (URL→vision→thinking) is critical — see docs/ARCHITECTURE.md.
 */

import {
  formatOpenAIToAnthropic,
  toOpenAIResponse,
  streamAnthropicToOpenAI,
} from '../translate';
import { DEFAULT_TIMEOUT, UPSTREAM_FORWARD_HEADERS } from '../config';
import { hasOpenAIImages, hasAnyImageInMessages, rawBodyMayHaveImages, getVisionModel } from '../vision';
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
import { RouteInfo } from './shared';

import { compressibleStream } from '../compress';

/**
 * Handle POST /v1/chat/completions — OpenAI client → upstream.
 *
 * When fmt is "anthropic", translates OpenAI Chat Completions body to Anthropic
 * Messages format and sends to the upstream's /v1/messages endpoint.
 * When fmt is not "anthropic", passes through to the upstream's /v1/chat/completions
 * endpoint with optional model override and image detection.
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

    const originalModel = req.model as string | undefined;
    if (route.modelOverride) req.model = route.modelOverride as string;
    if (hasOpenAIImages(req)) req.model = getVisionModel(upstream, req.model as string | null);
    const anthReq = formatOpenAIToAnthropic(req as Record<string, unknown>);
    const upstreamSignal = (anthReq as Record<string, unknown>).stream ? createStreamSignal(request) : AbortSignal.timeout(DEFAULT_TIMEOUT);
    const res = await safeUpstreamFetch(`${upstream}/v1/messages` as string, {
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
      const compressedResult = compressibleStream(streamAnthropicToOpenAI(res.body as ReadableStream, originalModel || ""), request);
      if (compressedResult.contentEncoding) streamHeaders.set("Content-Encoding", compressedResult.contentEncoding);
      return new Response(compressedResult.stream, {
        headers: streamHeaders,
      });
    }
    const data = await res.json() as Record<string, unknown>;
    const upstreamHeaders: Record<string, string> = {};
    for (const name of UPSTREAM_FORWARD_HEADERS) {
      const value = res.headers.get(name);
      if (value) upstreamHeaders[name] = value;
    }
    return jsonResponse(request, toOpenAIResponse(data, originalModel || ""), upstreamHeaders);
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
    if (oaiIsStreaming) {
      const ptHeaders = new Headers(oaiPassRes.headers);
      const compressed = compressibleStream(oaiPassRes.body as ReadableStream, request);
      if (compressed.contentEncoding) ptHeaders.set("Content-Encoding", compressed.contentEncoding);
      return new Response(compressed.stream, { headers: ptHeaders });
    }
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
  if (oaiIsStreaming) {
    const ptHeaders = new Headers(oaiPassRes.headers);
    const compressed = compressibleStream(oaiPassRes.body as ReadableStream, request);
    if (compressed.contentEncoding) ptHeaders.set("Content-Encoding", compressed.contentEncoding);
    return new Response(compressed.stream, { headers: ptHeaders });
  }
  return oaiPassRes;
}
