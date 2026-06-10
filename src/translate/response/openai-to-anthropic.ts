/**
 * OpenAI Chat Completions → Anthropic Messages response (non-streaming) translator.
 *
 * WHEN TO READ THIS FILE: Debugging response shape when proxying from OpenAI SDK
 * to Anthropic client, adding new response field mappings, or changing how
 * finish_reason / tool_calls map to Anthropic stop_reason / tool_use.
 */
import { extractCachedTokens, extractOutputTokens, extractUncachedInputTokens } from '../../cache';
import { asRecord, asRecordArray, asRecordOptional } from '../type-guards';

/**
 * Safely parses a tool call arguments JSON string (response-side).
 * Returns empty object on parse failure. Guards against non-object values.
 */
function parseToolArguments(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function formatOpenAIToAnthropic(completion: Record<string, unknown>, model: string): Record<string, unknown> {
  const messageId = "msg_" + Date.now();

  let content: Array<Record<string, unknown>> = [];
  const choices = asRecordArray(completion.choices);
  const message = asRecordOptional(choices[0]?.message);

  if (message?.reasoning_content) {
    content.push({ type: "thinking", thinking: message.reasoning_content, signature: "" });
  }

  if (message?.content) {
    content.push({ text: message.content, type: "text" });
  }

  if (message?.tool_calls) {
    const tcs = asRecordArray(message.tool_calls);
    content.push(...tcs.map((item) => {
      const fn = asRecordOptional(item.function);
      return {
        type: 'tool_use',
        id: item.id,
        name: fn?.name,
        input: parseToolArguments(fn?.arguments as string | undefined),
      };
    }));
  }

  // Map OpenAI finish_reason to Anthropic stop_reason
  const finishReason = choices[0]?.finish_reason as string | undefined;
  let stopReason = "end_turn";
  if (finishReason === "tool_calls") stopReason = "tool_use";
  else if (finishReason === "length") stopReason = "max_tokens";
  else if (finishReason === "stop") stopReason = "end_turn";
  else if (finishReason === "content_filter" || finishReason === "insufficient_system_resource") stopReason = "max_tokens";

  const result: { id: string; type: string; role: string; content: Array<Record<string, unknown>>; stop_reason: string; stop_sequence: null; model: string; usage?: Record<string, unknown> } = {
    id: messageId,
    type: "message",
    role: "assistant",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    model,
  };

  if (completion.usage) {
    const usage = asRecord(completion.usage);
    const cached = extractCachedTokens(usage);
    result.usage = {
      input_tokens: extractUncachedInputTokens(usage),
      output_tokens: extractOutputTokens(usage),
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0, // OpenAI doesn't expose write tokens
    };
  }

  return result;
}
