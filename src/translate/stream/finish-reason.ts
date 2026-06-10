/**
 * Maps OpenAI Chat Completions finish_reason to Anthropic stop_reason.
 *
 * WHEN TO READ THIS FILE: Adding support for new finish_reason values
 * from upstream providers, or changing the stop_reason mapping.
 * Used by openai-to-anthropic stream translator.
 */

export function mapFinishReason(finishReason: string | null | undefined): string {
  switch (finishReason) {
    case "tool_calls": return "tool_use";
    case "length": return "max_tokens";
    case "stop": return "end_turn";
    case "content_filter":
    case "insufficient_system_resource":
      return "max_tokens";
    default: return "end_turn";
  }
}
