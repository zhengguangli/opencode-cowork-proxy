/**
 * Root path: health-check info (no auth required).
 *
 * WHEN TO READ THIS FILE: Changing the health check response format, adding
 * new fields to the status payload, or modifying endpoint documentation.
 *
 * No authentication required — returns generic service info, version, uptime,
 * upstream URLs, and available endpoints.
 */

import { VERSION } from '../version';
import { START_TIME, GO_UPSTREAM, ZEN_UPSTREAM } from '../config';
import { jsonResponse, formatUptime } from '../request';

/**
 * Handle GET / — health check endpoint.
 *
 * Returns service name, version, status, uptime, upstream configuration,
 * and available API endpoints. No authentication required.
 */
export async function handleHealthCheck(upstream: string): Promise<Response> {
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
