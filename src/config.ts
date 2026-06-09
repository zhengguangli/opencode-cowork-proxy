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

export const IS_DEBUG = typeof process !== 'undefined' && process.env?.DEBUG;
