/**
 * OpenAI Responses API → Chat Completions (one-directional).
 *
 * WHEN TO READ THIS FILE: Debugging a Responses API translation bug, adding
 * Responses API features, or modifying the DeepSeek thinking auto-injection logic.
 *
 * This is a one-directional translation: OpenAI Responses API → Chat Completions.
 * There is no reverse path — responses flow back as Responses API format.
 *
 * IMPORTANT (pitfalls #11 and #12):
 * 1. Vision model override runs BEFORE DeepSeek thinking injection — this prevents
 *    injecting "thinking: {type:'enabled'}" on a model that was force-changed to
 *    a non-DeepSeek model by image detection.
 * 2. Debug logging via log.debug() provides verbose input/output inspection for tracing
 *    translation behavior — enabled when IS_DEBUG is true (config.ts).
 */

import {
  formatResponsesToChatCompletions,
  formatChatCompletionsToResponses,
  streamChatCompletionsToResponses,
} from '../translate';
import { DEFAULT_TIMEOUT, UPSTREAM_FORWARD_HEADERS } from '../config';
import { hasResponsesImages, getVisionModel } from '../vision';
import {
  authenticateRequest,
  safeJsonBody,
  safeUpstreamFetch,
  createStreamSignal,
  upstreamErrorResponse,
  forwardUpstreamHeaders,
  jsonResponse,
} from '../request';
import { asRecord, asRecordArray, asRecordOptional } from '../translate/type-guards';
import { RouteInfo } from './shared';
import { log } from '../logger';

/**
 * Handle POST /v1/responses — OpenAI Responses API client → Chat Completions upstream.
 *
 * Translates Responses API request body to Chat Completions format, sends to
 * upstream, and translates the response back to Responses API format.
 * Supports both streaming and non-streaming.
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
  log.debug('RESPONSES', `Incoming model=${req.model}, originalModel=${originalModel}, route.modelOverride=${route.modelOverride}`);
  log.debug('RESPONSES', `Input type=${typeof req.input}, has thinking=${!!req.thinking}`);

  if (Array.isArray(req.input)) {
    for (let ii = 0; ii < req.input.length; ii++) {
      const item = asRecord(req.input[ii]);
      if (item.type === 'message') {
        const contentPreview = Array.isArray(item.content)
          ? asRecordArray(item.content).map((p) => p.type).join(',')
          : typeof item.content;
        log.debug('RESPONSES', `  input[${ii}] type=${item.type} role=${item.role} content_types=[${contentPreview}]`);
      } else if (item.type === 'reasoning') {
        log.debug('RESPONSES', `  input[${ii}] type=${item.type} reasoning_len=${String(item.reasoning_text || '').length}`);
      } else {
        log.debug('RESPONSES', `  input[${ii}] type=${item.type}`);
      }
    }
  } else if (typeof req.input === 'string') {
    log.debug('RESPONSES', `  input string len=${req.input.length}`);
  } else {
    log.debug('RESPONSES', `  input other type=${typeof req.input}`);
  }

  if (route.modelOverride) req.model = route.modelOverride;

  // Vision model override before DeepSeek thinking injection
  if (hasResponsesImages(req)) {
    req.model = getVisionModel(upstream, req.model as string | null);
  }

  // DeepSeek: auto-inject thinking for reasoning models
  if ((req.model as string)?.startsWith('deepseek-') && !(req as Record<string, unknown>).thinking) {
    req.thinking = { type: "enabled" };
  }

  const chatReq = formatResponsesToChatCompletions(req as Record<string, unknown>);
  log.debug('RESPONSES', `ChatReq model=${(chatReq as Record<string, unknown>).model}, messages count=${asRecordArray((chatReq as Record<string, unknown>).messages).length}`);
  const msgs = asRecordArray(chatReq.messages);
  for (let mi = 0; mi < msgs.length; mi++) {
    const m = msgs[mi];
    const preview = m.role === 'user' ? `"${String(m.content || '').slice(0, 120)}"`
      : m.role === 'assistant' ? `len=${String(m.content || '').length} reasoning=${!!m.reasoning_content} tool_calls=${((m.tool_calls || []) as unknown[]).length}`
      : `"${String(m.content || '').slice(0, 80)}"`;
    log.debug('RESPONSES', `  msg[${mi}] role=${m.role} content=${preview}`);
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
    log.debug('RESPONSES', 'Streaming response');
    const streamHeaders = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    forwardUpstreamHeaders(streamHeaders, upstreamRes);
    return new Response(streamChatCompletionsToResponses(upstreamRes.body as ReadableStream, originalModel as string), {
      headers: streamHeaders,
    });
  }

  const data: Record<string, unknown> = await upstreamRes.json();
  log.debug('RESPONSES', `Upstream response keys=${Object.keys(data).join(',')}`);
  const firstChoice = asRecordOptional(asRecordArray(data.choices)[0]);
  const firstMsg = asRecordOptional(firstChoice?.message);
  log.debug('RESPONSES', `Upstream reasoning_content=${!!firstMsg?.reasoning_content}`);
  const upstreamContent = String(firstMsg?.content || '');
  log.debug('RESPONSES', `Upstream content preview=${upstreamContent.slice(0, 200)}`);
  if (upstreamContent.includes('<think>')) {
    log.warn('RESPONSES', '⚠️  FOUND <think> tags in upstream content!');
  }

  const respData = formatChatCompletionsToResponses(data, originalModel as string || "");
  const outputItems = asRecordArray(respData.output);
  log.debug('RESPONSES', `Translated output item types=${outputItems.map((o) => o.type).join(',')}`);
  const msgItem = asRecordOptional(outputItems.find((o) => o.type === 'message'));
  const textOutput = String(asRecordArray(msgItem?.content)?.[0]?.text || '');
  if (textOutput.includes('<think>')) {
    log.warn('RESPONSES', '⚠️  FOUND <think> tags in translated output text!');
  }

  const upstreamHeaders: Record<string, string> = {};
  for (const name of UPSTREAM_FORWARD_HEADERS) {
    const value = upstreamRes.headers.get(name);
    if (value) upstreamHeaders[name] = value;
  }
  return jsonResponse(request, respData, upstreamHeaders);
}
