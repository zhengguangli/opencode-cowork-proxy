/**
 * Prompt cache key generation and cache token extraction utilities.
 * Bridges Anthropic's explicit cache_control markers with OpenAI's automatic prefix caching.
 */

/** djb2 hash of system prompt text, used as prompt_cache_key for OpenAI node affinity */
export function hashSystemPrompt(system: string | any[] | undefined): string | null {
  if (!system) return null;
  const text = typeof system === 'string'
    ? system
    : system.map((s: any) => s.text || '').join('\n');
  if (!text.trim()) return null;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash = hash & hash; // 32-bit
  }
  return 'cache-' + Math.abs(hash).toString(36);
}

/** Check if any message, system prompt, or Responses API input has Anthropic cache_control markers */
export function hasCacheControl(messages: any[], system?: any, body?: any): boolean {
  if (Array.isArray(system)) {
    if (system.some((s: any) => s.cache_control)) return true;
  }
  if (typeof system === 'object' && system?.cache_control) return true;

  // Check Responses API input format (for /v1/responses compatibility)
  const input = body?.input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item.type === "message" && Array.isArray(item.content)) {
        if (item.content.some((block: any) => block.cache_control)) return true;
      }
    }
  }

  for (const msg of messages || []) {
    if (Array.isArray(msg.content)) {
      if (msg.content.some((block: any) => block.cache_control)) return true;
    }
  }
  return false;
}

function tokenCount(...values: any[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

/** Extract cached token count from common OpenAI-compatible usage shapes. */
export function extractCachedTokens(usage: any): number {
  return tokenCount(
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.input_tokens_details?.cached_tokens,
    usage?.cache_read_input_tokens,
    usage?.prompt_cache_hit_tokens, // DeepSeek-specific
  );
}

/** Extract input token count from OpenAI, Anthropic, and OpenAI-compatible providers. */
export function extractInputTokens(usage: any): number {
  return tokenCount(
    usage?.prompt_tokens,
    usage?.input_tokens,
    usage?.promptTokens,
    usage?.inputTokens,
  );
}

/**
 * Extracts uncached (non-cache-read) input tokens from usage statistics.
 *
 * Assumes OpenAI-style usage where prompt_tokens already includes cached tokens,
 * so cached tokens are subtracted to avoid double-counting when mapping to Anthropic format.
 *
 * Do NOT call with pure Anthropic-style usage where input_tokens and cache_read_input_tokens
 * are separate counts with no overlap — that would incorrectly subtract cached tokens that
 * were never part of the input token count to begin with.
 */
export function extractUncachedInputTokens(usage: any): number {
  return Math.max(0, extractInputTokens(usage) - extractCachedTokens(usage));
}

/** Extract output token count from OpenAI, Anthropic, and OpenAI-compatible providers. */
export function extractOutputTokens(usage: any): number {
  return tokenCount(
    usage?.completion_tokens,
    usage?.output_tokens,
    usage?.completionTokens,
    usage?.outputTokens,
  );
}

/**
 * Map Chat Completions usage to Responses API usage format.
 * Handles both standard OpenAI (prompt_tokens_details.cached_tokens)
 * and DeepSeek-specific (prompt_cache_hit_tokens) cache formats.
 */
export function mapUsage(usage: any): any {
  if (!usage) return undefined;

  const hasDeepSeekCache = usage.prompt_cache_hit_tokens !== undefined;

  let inputTokens: number;
  let cachedTokens: number;

  if (hasDeepSeekCache) {
    inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    cachedTokens = typeof usage.prompt_cache_hit_tokens === "number" ? usage.prompt_cache_hit_tokens : 0;
  } else {
    inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
  }

  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : inputTokens + outputTokens;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;

  const result: any = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };

  if (cachedTokens > 0) {
    result.input_tokens_details = { cached_tokens: cachedTokens };
  }

  if (reasoningTokens !== undefined) {
    result.output_tokens_details = { reasoning_tokens: reasoningTokens };
  }

  return result;
}
