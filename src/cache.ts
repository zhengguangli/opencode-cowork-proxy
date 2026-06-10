/**
 * Prompt cache key generation and cache token extraction utilities.
 *
 * WHEN TO READ THIS FILE: Investigating token count discrepancies, adding support
 * for a new provider's usage reporting format, or modifying prompt caching behavior.
 *
 * Bridges Anthropic's explicit cache_control markers with OpenAI's automatic prefix caching.
 */

import { asRecordOptional } from './translate/type-guards';

/** djb2 hash of system prompt text, used as prompt_cache_key for OpenAI node affinity */
export function hashSystemPrompt(system: string | Array<Record<string, unknown>> | undefined): string | null {
  if (!system) return null;
  const text = typeof system === 'string'
    ? system
    : system.map((s: Record<string, unknown>) => String(s.text || '')).join('\n');
  if (!text.trim()) return null;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash = hash & hash; // 32-bit
  }
  return 'cache-' + Math.abs(hash).toString(36);
}

function tokenCount(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

/** Extract cached token count from common OpenAI-compatible usage shapes. */
export function extractCachedTokens(usage: Record<string, unknown>): number {
  if (!usage) return 0;
  return tokenCount(
    asRecordOptional(usage.prompt_tokens_details)?.cached_tokens,
    asRecordOptional(usage.input_tokens_details)?.cached_tokens,
    usage.cache_read_input_tokens,
    usage.prompt_cache_hit_tokens, // DeepSeek-specific
  );
}

/** Extract input token count from OpenAI, Anthropic, and OpenAI-compatible providers. */
export function extractInputTokens(usage: Record<string, unknown>): number {
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
export function extractUncachedInputTokens(usage: Record<string, unknown>): number {
  return Math.max(0, extractInputTokens(usage) - extractCachedTokens(usage));
}

/** Extract output token count from OpenAI, Anthropic, and OpenAI-compatible providers. */
export function extractOutputTokens(usage: Record<string, unknown>): number {
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
export function mapUsage(usage: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!usage) return undefined;

  const hasDeepSeekCache = usage.prompt_cache_hit_tokens !== undefined;

  let inputTokens: number;
  let cachedTokens: number;

  if (hasDeepSeekCache) {
    inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    cachedTokens = typeof usage.prompt_cache_hit_tokens === "number" ? usage.prompt_cache_hit_tokens : 0;
  } else {
    inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    const details = asRecordOptional(usage.prompt_tokens_details);
    cachedTokens = typeof details?.cached_tokens === "number" ? details.cached_tokens : 0;
  }

  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : inputTokens + outputTokens;
  const compDetails = asRecordOptional(usage.completion_tokens_details);
  const reasoningTokens = typeof compDetails?.reasoning_tokens === "number" ? compDetails.reasoning_tokens : undefined;

  const result: Record<string, unknown> = {
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
