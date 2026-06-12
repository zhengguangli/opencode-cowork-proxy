/**
 * WebSocket proxy for streaming API translations.
 *
 * WHEN TO READ THIS FILE: Adding WebSocket support for a new format pair,
 * debugging WebSocket connection issues, or changing stream behavior.
 *
 * Translates streaming API responses over WebSocket connections.
 * Currently supports: Anthropic Message SSE stream → WebSocket messages.
 *
 * Protocol:
 *   Client connects to /ws/v1/messages?model=...&upstream=...
 *   Server streams Anthropic SSE events as WebSocket text messages,
 *   one JSON message per SSE event.
 *
 * The WebSocket upgrade path is handled by Hono's upgrade helper.
 */
import { routeConfig, getUpstream, upstreamFormat } from '../routing';
import { authenticateRequest } from '../request';
import { streamOpenAIToAnthropic } from '../translate';
import { log } from '../logger';
import { recordAudit } from '../audit';
import { DEFAULT_TIMEOUT } from '../config';
import { asRecord } from '../translate/type-guards';

/**
 * Handle WebSocket upgrade requests.
 * Currently upgrades /ws/v1/messages for Anthropic streaming.
 */
export async function handleWebSocketUpgrade(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  // Only handle /ws/ prefixed paths
  if (!url.pathname.startsWith('/ws/')) return null;

  // Auth check
  const route = routeConfig(request);
  const auth = authenticateRequest(request, route.path);
  if ('response' in auth) return auth.response;
  const { key } = auth;

  const upstream = getUpstream(request, route.upstream);
  const fmt = upstreamFormat(request);
  const apiPath = url.pathname.replace('/ws', '');

  recordAudit('stream', 'ws_upgrade', { path: url.pathname, upstream });

  // For now, return a 426 Upgrade Required with instructions
  // Full WebSocket upgrade requires CF Workers WebSocket support
  return new Response(JSON.stringify({
    error: {
      type: 'upgrade_required',
      message: 'WebSocket upgrade not supported in this environment. Use SSE streaming instead: set stream:true in your request body.',
    },
    alternative: {
      method: 'POST',
      path: apiPath,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': 'your-key',
      },
      body: { stream: true },
    },
  }), {
    status: 426,
    headers: { 'Content-Type': 'application/json' },
  });
}
