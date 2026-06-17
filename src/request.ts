/**
 * Request utilities: upstream fetch, auth orchestration, error relay, streaming signal,
 * gzip compression, JSON response construction, and body size checking.
 *
 * WHEN TO READ THIS FILE: Debugging upstream connection issues, changing auth flow,
 * modifying timeout/retry behavior, or adding response compression.
 *
 * DEPENDENCY NOTE: This is a singleton module that combines multiple concerns
 * (auth, fetch, gzip, error relay) because index.ts needs all of them at every
 * branch point. See ARCHITECTURE.md ADR-3 for rationale.
 *
 * KEY FUNCTIONS:
 *   authenticateRequest()   — Extract + validate API key, return auth result
 *   safeJsonBody()          — Parse JSON with try/catch, return Result type
 *   safeUpstreamFetch()     — Fetch with retry, jitter, and error handling
 *   upstreamErrorResponse() — Forward upstream error body + headers unchanged
 *   createStreamSignal()    — Stream abort signal (STREAM_TIMEOUT + client disconnect)
 *   checkBodySize()         — Reject oversized request bodies (>MAX_BODY_SIZE)
 *   anthropicHeaders()      — Build Anthropic-format auth headers
 *   jsonResponse()          — Build JSON response with optional gzip compression
 *   forwardUpstreamHeaders()— Copy upstream rate-limit headers to response
 *   formatUptime()          — Format uptime seconds as human-readable string
 */

import { extractApiKey, validateApiKey, authErrorResponse } from './auth';
import { UPSTREAM_FORWARD_HEADERS, MAX_BODY_SIZE, MAX_RETRIES, RETRY_BASE_DELAY, STREAM_TIMEOUT } from './config';
import { log } from './logger';
import { trackRateLimits } from './rate-limit';
import { metricsRegistry } from './metrics';
import { getRequestId } from './log/context';
import { startSpan, endSpan, recordError } from './tracing';

export function anthropicHeaders(request: Request, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": key,
    "Anthropic-Version": request.headers.get("Anthropic-Version") || "2023-06-01",
  };
  const beta = request.headers.get("Anthropic-Beta");
  if (beta) headers["Anthropic-Beta"] = beta;
  // Propagate request ID for trace correlation
  const reqId = getRequestId();
  if (reqId) headers["X-Request-Id"] = reqId;
  return headers;
}

export function upstreamErrorResponse(res: Response, body: string): Response {
  const headers = new Headers();
  for (const name of ["Content-Type", "Retry-After", ...UPSTREAM_FORWARD_HEADERS]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(body, { status: res.status, headers });
}

export function createStreamSignal(request: Request): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT);
  request.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    controller.abort();
  }, { once: true });
  return controller.signal;
}

export async function safeJsonBody<T>(request: Request): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  try {
    const data = await request.json() as T;
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

/** Check request body size against max body size. Returns 413 if exceeded.
 *
 * Fast path: uses Content-Length header when present (no body read).
 * Fallback: when header is missing (e.g. chunked transfer), clones the request
 * and reads the actual body. The original request body is preserved for downstream
 * consumers (safeJsonBody, request.text()).
 */
export async function checkBodySize(request: Request): Promise<Response | null> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > MAX_BODY_SIZE) {
      return new Response(
        JSON.stringify({ error: { type: "invalid_request_error", message: `Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes` } }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
    return null;
  }

  // No Content-Length header — read actual body via clone to preserve original
  try {
    const cloned = request.clone();
    const body = await cloned.arrayBuffer();
    if (body.byteLength > MAX_BODY_SIZE) {
      return new Response(
        JSON.stringify({ error: { type: "invalid_request_error", message: `Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes` } }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
  } catch {
    // clone() or arrayBuffer() failed (e.g., body already consumed) — pass through
  }
  return null;
}

export function authenticateRequest(request: Request, path: string): { key: string } | { response: Response } {
  const key = extractApiKey(request.headers);
  const err = validateApiKey(key);
  if (err) return { response: authErrorResponse(err, path) };
  if (!key) return { response: authErrorResponse({ status: 401, body: { error: { type: "authentication_error", message: "Invalid API key" } } }, path) };
  return { key };
}

export async function safeUpstreamFetch(url: string, init: RequestInit): Promise<Response> {
  const fetchSpan = startSpan('upstream.fetch');

  // Don't retry streaming requests — can't replay SSE.
  let isStreaming = false;
  if (typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      isStreaming = !!(parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).stream);
    } catch {
      // Fall back to heuristic for non-JSON or malformed bodies
      isStreaming = init.body.includes('"stream":true') || init.body.includes('"stream": true');
    }
  }

  // Extract hostname for upstream metrics labeling
  const upstreamLabel = (() => {
    try { return new URL(url).hostname; } catch { return 'unknown'; }
  })();
  fetchSpan.setAttribute('upstream', upstreamLabel);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    fetchSpan.setAttribute('retry_attempt', attempt);
    try {
      const res = await fetch(url, init);

      // Track rate-limit headers from upstream
      trackRateLimits(url, res);

      // Not retryable — return immediately
      if (res.status < 500) {
        // 2xx, 3xx, 4xx (incl. 429) — no retry
        endSpan(fetchSpan, { upstream_status: res.status, success: true });
        metricsRegistry.recordUpstreamRequest(upstreamLabel);
        return res;
      }

      // 5xx Server Error — retryable (exponential backoff with full jitter)
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt) + Math.random() * 200, 10_000);
        log.warn('RETRY', `Attempt ${attempt + 1}/${MAX_RETRIES} got ${res.status}, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Last attempt — record and return whatever we got
      endSpan(fetchSpan, { upstream_status: res.status, error: `upstream ${res.status}` });
      metricsRegistry.recordUpstreamRequest(upstreamLabel);
      metricsRegistry.recordUpstreamError(upstreamLabel, res.status);
      return res;
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        endSpan(fetchSpan, { upstream_status: 499, error: 'aborted' });
        metricsRegistry.recordUpstreamRequest(upstreamLabel);
        metricsRegistry.recordUpstreamError(upstreamLabel, 499);
        return new Response(
          JSON.stringify({ error: { type: "upstream_error", message: "Request aborted" } }),
          { status: 499, headers: { "Content-Type": "application/json" } },
        );
      }

      // Network error — retry if attempts remain
      if (attempt < MAX_RETRIES && !isStreaming) {
        const delay = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt) + Math.random() * 200, 10_000);
        log.warn('RETRY', `Network error on attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (err instanceof Error) recordError(fetchSpan, err);
      endSpan(fetchSpan, { upstream_status: 502, error: 'unreachable' });
      metricsRegistry.recordUpstreamError(upstreamLabel, 502);
      return new Response(
        JSON.stringify({ error: { type: "upstream_error", message: "Upstream unreachable" } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  // Should not reach here, but satisfy TypeScript
  endSpan(fetchSpan, { upstream_status: 502, error: 'exhausted' });
  metricsRegistry.recordUpstreamError(upstreamLabel, 502);
  return new Response(
    JSON.stringify({ error: { type: "upstream_error", message: "Exhausted retries" } }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  );
}

export function forwardUpstreamHeaders(target: Headers, source: Response): void {
  for (const name of UPSTREAM_FORWARD_HEADERS) {
    const value = source.headers.get(name);
    if (value) target.set(name, value);
  }
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function clientAcceptsGzip(request: Request): boolean {
  const accept = request.headers.get("Accept-Encoding") || "";
  return accept.includes("gzip");
}

export async function jsonResponse(request: Request, data: unknown, extraHeaders?: Record<string, string>): Promise<Response> {
  const body = JSON.stringify(data);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };

  if (clientAcceptsGzip(request) && body.length > 1024) {
    try {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode(body)); controller.close(); },
      }).pipeThrough(new CompressionStream("gzip"));

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((n, c) => n + c.length, 0);
      const compressed = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) { compressed.set(chunk, offset); offset += chunk.length; }

      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      return new Response(compressed, { headers });
    } catch {
    }
  }

  return new Response(body, { headers });
}
