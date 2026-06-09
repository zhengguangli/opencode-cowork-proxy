/**
 * Converts Anthropic Messages response to OpenAI Chat Completions response.
 */
import { extractInputTokens, extractOutputTokens } from '../../cache';

export function formatAnthropicToOpenAI(response: Record<string, unknown>, model: string): Record<string, unknown> {
  const content = response.content || [];

  let textContent = "";
  let reasoningContent = "";
  const toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = [];

  for (const block of content) {
    if (block.type === "text") {
      textContent += block.text;
    } else if (block.type === "thinking") {
      reasoningContent += (typeof block.thinking === "string" ? block.thinking : JSON.stringify(block.thinking)) + "\n";
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input),
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
    usage: response.usage
      ? (() => {
          const input = extractInputTokens(response.usage);
          const output = extractOutputTokens(response.usage);
          const cached = response.usage.cache_read_input_tokens || response.usage.cache_creation_input_tokens || 0;
          const result: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens: number } } = { prompt_tokens: input + cached, completion_tokens: output, total_tokens: input + output + cached };
          if (cached > 0) {
            result.prompt_tokens_details = { cached_tokens: cached };
          }
          return result;
        })()
      : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
