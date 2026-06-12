/**
 * Anthropic Messages → OpenAI Chat Completions response (non-streaming) translator.
 *
 * WHEN TO READ THIS FILE: Debugging response shape / finish_reason mapping,
 * adding new content block types, or changing how tool_use → tool_calls conversion works.
 */
import { extractInputTokens, extractOutputTokens } from '../../cache';
import { asRecordArray, asRecordOptional } from '../type-guards';

export function formatAnthropicToOpenAI(response: Record<string, unknown>, model: string): Record<string, unknown> {
  const content = asRecordArray(response.content);

  let textContent = "";
  let reasoningContent = "";
  const toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = [];

  for (const block of content) {
    if ((block as Record<string, unknown>).type === "text") {
      textContent += String((block as Record<string, unknown>).text || "");
    } else if ((block as Record<string, unknown>).type === "thinking") {
      const thinkingVal = (block as Record<string, unknown>).thinking;
      reasoningContent += (typeof thinkingVal === "string" ? thinkingVal : JSON.stringify(thinkingVal)) + "\n";
    } else if ((block as Record<string, unknown>).type === "tool_use") {
      const b = block as Record<string, unknown>;
      toolCalls.push({
        id: b.id as string,
        type: "function",
        function: {
          name: b.name as string,
          arguments: typeof b.input === "string" ? b.input as string : JSON.stringify(b.input),
        },
      });
    }
  }

  const message: { role: string; content?: string | null; reasoning_content?: string; tool_calls?: typeof toolCalls } = { role: "assistant" };

  if (textContent) {
    message.content = textContent;
  } else {
    message.content = null;
  }

  if (reasoningContent.trim()) {
    message.reasoning_content = reasoningContent.trim();
  }

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id: "chatcmpl-" + Date.now(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: response.stop_reason === "tool_use" ? "tool_calls"
                     : response.stop_reason === "max_tokens" ? "length"
                     : "stop",
      },
    ],
    usage: asRecordOptional(response.usage)
      ? (() => {
          const input = extractInputTokens(asRecordOptional(response.usage) || {});
          const output = extractOutputTokens(asRecordOptional(response.usage) || {});
          const usage = asRecordOptional(response.usage); const cached = (usage?.cache_read_input_tokens as number) || (usage?.cache_creation_input_tokens as number) || 0;
          const result: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens: number } } = { prompt_tokens: input + cached, completion_tokens: output, total_tokens: input + output + cached };
          if (cached > 0) {
            result.prompt_tokens_details = { cached_tokens: cached };
          }
          return result;
        })()
      : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
