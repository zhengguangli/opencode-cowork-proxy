/**
 * Project-wide constants and configuration.
 *
 * WHEN TO READ THIS FILE: Adding a new upstream, updating vision model lists,
 * changing timeouts/retries/body limits, or understanding upstream routing.
 *
 * ⚠️ VISION MODEL SETS (VISION_CAPABLE_GO / VISION_CAPABLE_ZEN):
 * These must match what the upstream actually serves. When adding a new
 * vision-capable model to the upstream, update BOTH sets. When the upstream
 * removes a model, remove it from both sets. A stale entry means
 * getVisionModel() returns a model ID the upstream no longer recognizes,
 * causing 404 errors.
 *
 * Verify against upstream catalogs:
 *   curl -s https://opencode.ai/zen/go/v1/models  (for /go)
 *   curl -s https://opencode.ai/zen/v1/models     (for /zen)
 */

export const GO_UPSTREAM = "https://opencode.ai/zen/go";
export const ZEN_UPSTREAM = "https://opencode.ai/zen";
export const DEFAULT_UPSTREAM = GO_UPSTREAM;
export const START_TIME = Date.now();
export const GO_VISION_MODEL = "qwen3.6-plus";
export const ZEN_VISION_MODEL = "mimo-v2.5-free";

export const VISION_CAPABLE_GO = new Set<string>([
  "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1",
  "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4",
  "claude-haiku-4-5",
  "gemini-3.5-flash", "gemini-3.1-pro", "gemini-3-flash",
  "gpt-5.5", "gpt-5.5-pro",
  "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini",
  "gpt-5.3-codex-spark", "gpt-5.3-codex",
  "gpt-5.2", "gpt-5.2-codex",
  "gpt-5.1", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1-codex-mini",
  "gpt-5", "gpt-5-codex",
  "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus",
  "mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5-pro", "mimo-v2.5",
  "hy3-preview",
]);

export const VISION_CAPABLE_ZEN = new Set<string>([
  "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1",
  "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4",
  "claude-haiku-4-5",
  "gemini-3.5-flash", "gemini-3.1-pro", "gemini-3-flash",
  "gpt-5.5", "gpt-5.5-pro",
  "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini",
  "gpt-5.3-codex-spark", "gpt-5.3-codex",
  "gpt-5.2", "gpt-5.2-codex",
  "gpt-5.1", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1-codex-mini",
  "gpt-5", "gpt-5-codex",
  "qwen3.6-plus", "qwen3.5-plus",
  "mimo-v2.5-free",
]);

export const API_VERSION_PATTERN = /^v\d+$/;

export const UPSTREAM_FORWARD_HEADERS = [
  "X-Request-Id",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "X-RateLimit-Limit-Requests",
  "X-RateLimit-Limit-Tokens",
];

declare const process: { env?: Record<string, string | undefined> } | undefined;
export const IS_DEBUG = typeof process !== 'undefined' && process?.env?.DEBUG;

/** Cloudflare Cache TTL for model list responses (in seconds) */
export const MODEL_CACHE_TTL = 300;

/** Max request body size in bytes (10 MB — typical API payloads are under 1 MB) */
export const MAX_BODY_SIZE = 10 * 1024 * 1024;

/** Max retries for transient upstream errors (5xx, 429) */
export const MAX_RETRIES = 2;

/** Base delay in ms for exponential backoff (actual: base * 2^attempt + jitter) */
export const RETRY_BASE_DELAY = 500;

/** Default upstream response timeout for non-streaming requests (60 s) */
export const DEFAULT_TIMEOUT = 60_000;

/** Upstream model list fetch timeout (10 s) */
export const MODEL_LIST_TIMEOUT = 10_000;

/** Stream abort timeout — client must respond or the connection is dropped (120 s) */
export const STREAM_TIMEOUT = 120_000;
