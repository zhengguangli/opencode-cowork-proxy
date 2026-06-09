import { extractApiKey, validateApiKey, authErrorResponse } from './auth';
import { UPSTREAM_FORWARD_HEADERS } from './config';

export function anthropicHeaders(request: Request, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": key,
    "Anthropic-Version": request.headers.get("Anthropic-Version") || "2023-06-01",
  };
  const beta = request.headers.get("Anthropic-Beta");
  if (beta) headers["Anthropic-Beta"] = beta;
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
  const timeoutId = setTimeout(() => controller.abort(), 120_000);
  request.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    controller.abort();
  }, { once: true });
  return controller.signal;
}

export async function safeJsonBody<T>(request: Request): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
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

export function authenticateRequest(request: Request, path: string): { key: string } | { response: Response } {
  const key = extractApiKey(request.headers);
  const err = validateApiKey(key);
  if (err) return { response: authErrorResponse(err, path) };
  if (!key) return { response: authErrorResponse({ status: 401, body: { error: { type: "authentication_error", message: "Invalid API key" } } }, path) };
  return { key };
}

export async function safeUpstreamFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: unknown) {
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
