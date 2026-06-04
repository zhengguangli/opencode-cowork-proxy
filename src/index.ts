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

const GO_UPSTREAM = "https://opencode.ai/zen/go/v1";
const ZEN_UPSTREAM = "https://opencode.ai/zen/v1";
const DEFAULT_UPSTREAM = GO_UPSTREAM;
const VISION_MODEL = "qwen3.6-plus";

const API_START_PATHS = new Set(['v1', 'v2']);

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
  if (segments.length > 0 && segments[0] && !API_START_PATHS.has(segments[0])) {
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
  return request.headers.get("X-Upstream-Url") || routeUpstream;
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
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((msg: any) =>
    Array.isArray(msg.content) && msg.content.some((part: any) => part.type === "image")
  );
}

function hasResponsesImages(body: any): boolean {
  const input = body?.input;
  if (!Array.isArray(input)) return false;
  return input.some((item: any) =>
    item.type === "message" && Array.isArray(item.content) &&
    item.content.some((part: any) => part.type === "input_image" || part.type === "image_url")
  );
}

function hasOpenAIImages(body: any): boolean {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((msg: any) => {
    if (typeof msg.content === "string") return false;
    if (Array.isArray(msg.content)) {
      return msg.content.some((part: any) => part.type === "image_url");
    }
    return false;
  });
}

function upstreamErrorResponse(res: Response, body: string): Response {
  const headers = new Headers();
  for (const name of ["Content-Type", "Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "X-Request-Id", "X-RateLimit-Limit-Requests", "X-RateLimit-Limit-Tokens"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(body, { status: res.status, headers });
}

async function handleRequest(request: Request): Promise<Response> {
  const route = routeConfig(request);
  const upstream = getUpstream(request, route.upstream);
  const fmt = upstreamFormat(request);

  // Anthropic → OpenAI (for Claude Desktop/Cowork → any OpenAI API)
  if (route.path === '/v1/messages' && request.method === 'POST') {
      const key = extractApiKey(request.headers);
      const err = validateApiKey(key);
      if (err) return authErrorResponse(err);

      if (fmt === "openai") {
        const req = await request.json();
        const originalModel = req.model;
        if (route.modelOverride) req.model = route.modelOverride;
        if (hasImages(req)) {
          req.model = VISION_MODEL;
        }
        const openaiReq = formatAnthropicToOpenAI(req);
        const res = await fetch(`${upstream}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`,
          },
          body: JSON.stringify(openaiReq),
        });
        if (!res.ok) return upstreamErrorResponse(res, await res.text());

        if (openaiReq.stream) {
          return new Response(streamOpenAIToAnthropic(res.body as ReadableStream, originalModel), {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
          });
        }
        const data: any = await res.json();
        return new Response(JSON.stringify(toAnthropicResponse(data, originalModel)), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Pass-through to Anthropic upstream (with model override applied)
      const anthReqJson = await request.json();
      if (route.modelOverride) anthReqJson.model = route.modelOverride;
      if (hasImages(anthReqJson)) anthReqJson.model = VISION_MODEL;
      const anthPassRes = await fetch(`${upstream}/v1/messages`, {
        method: "POST",
        headers: anthropicHeaders(request, key!),
        body: JSON.stringify(anthReqJson),
      });
      return anthPassRes;
  }

  // OpenAI → Anthropic (or pass-through)
  if (route.path === '/v1/chat/completions' && request.method === 'POST') {
      const key = extractApiKey(request.headers);
      const err = validateApiKey(key);
      if (err) return authErrorResponse(err);

      if (fmt === "anthropic") {
        const req = await request.json();
        const originalModel = req.model;
        if (route.modelOverride) req.model = route.modelOverride;
        if (hasOpenAIImages(req)) req.model = VISION_MODEL;
        const anthReq = formatOpenAIToAnthropic(req);
        const res = await fetch(`${upstream}/v1/messages`, {
          method: "POST",
          headers: anthropicHeaders(request, key!),
          body: JSON.stringify(anthReq),
        });
        if (!res.ok) return upstreamErrorResponse(res, await res.text());

        if (anthReq.stream) {
          return new Response(streamAnthropicToOpenAI(res.body as ReadableStream, originalModel), {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
          });
        }
        const data: any = await res.json();
        return new Response(JSON.stringify(toOpenAIResponse(data, originalModel)), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Pass-through to OpenAI upstream (with model override applied)
      const oaiReqJson = await request.json();
      if (route.modelOverride) oaiReqJson.model = route.modelOverride;
      if (hasOpenAIImages(oaiReqJson)) oaiReqJson.model = VISION_MODEL;
      const oaiPassRes = await fetch(`${upstream}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify(oaiReqJson),
      });
      return oaiPassRes;
  }

  // Responses API → Chat Completions
  if (route.path === '/v1/responses' && request.method === 'POST') {
      const key = extractApiKey(request.headers);
      const err = validateApiKey(key);
      if (err) return authErrorResponse(err);

      const req = await request.json();
      const originalModel = req.model;
      if (route.modelOverride) req.model = route.modelOverride;

      // DeepSeek compatibility: auto-inject thinking for reasoning models
      if (req.model?.startsWith('deepseek-') && !req.thinking) {
        req.thinking = { type: "enabled" };
      }

      // Vision model override: force qwen3.6-plus when images detected
      if (hasResponsesImages(req)) {
        req.model = VISION_MODEL;
      }

      const chatReq = formatResponsesToChatCompletions(req);
      const upstreamRes = await fetch(`${upstream}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify(chatReq),
      });
      if (!upstreamRes.ok) return upstreamErrorResponse(upstreamRes, await upstreamRes.text());

      if (chatReq.stream) {
        return new Response(streamChatCompletionsToResponses(upstreamRes.body as ReadableStream, originalModel), {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
        });
      }

      const data: any = await upstreamRes.json();
      return new Response(JSON.stringify(formatChatCompletionsToResponses(data, originalModel)), {
        headers: { "Content-Type": "application/json" },
      });
  }

  // Model discovery
  if (route.path === '/v1/models' && request.method === 'GET') {
      const key = extractApiKey(request.headers);
      const err = validateApiKey(key);
      if (err) return authErrorResponse(err);

      const res = fmt === "anthropic"
        ? await fetch(`${upstream}/v1/models`, {
            method: "GET",
            headers: anthropicHeaders(request, key),
          })
        : await fetch(`${upstream}/models`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${key}` },
      });
      if (!res.ok) return upstreamErrorResponse(res, await res.text());
      return new Response(await res.text(), { headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({
    name: "opencode-cowork-proxy",
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
    status: route.path === '/' ? 200 : 404,
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
