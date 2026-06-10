/**
 * Converts OpenAI Chat Completions response to OpenAI Responses API response.
 *
 * Maps /chat/completions response format to /v1/responses format, handling:
 * - Text messages → output_text content blocks
 * - DeepSeek reasoning_content → reasoning output item
 * - Tool calls → function_call output items
 * - Usage mapping (including DeepSeek-specific cache fields)
 * - finish_reason/stop_reason mapping
 */
import { mapUsage } from '../../cache';
import { stripThinkTags } from '../../think-tag-stripper';

export function formatChatCompletionsToResponses(completion: Record<string, unknown>, model: string): Record<string, unknown> {
  const choice = (completion.choices as Array<Record<string, unknown>>)?.[0] || {};
  const message = (choice.message as Record<string, unknown>) || {};

  const respId = "resp_" + Date.now() + Math.random().toString(36).slice(2, 6);
  const status = mapFinishReason(choice.finish_reason as string | undefined);
  const output: Array<Record<string, unknown>> = [];

  // 1. DeepSeek: reasoning_content → type:"reasoning" output item (before message)
  if (message.reasoning_content) {
    output.push({
      type: "reasoning",
      id: "rsn_" + Date.now(),
      reasoning_text: message.reasoning_content,
    });
  }

  // 2. Content → type:"message" output item with output_text content block
  const contentText = message.content ? stripThinkTags(String(message.content)) : message.content;
  if (contentText || message.tool_calls) {
    const contentBlocks: Array<Record<string, unknown>> = [];

    // Text content
    if (contentText) {
      contentBlocks.push({
        type: "output_text",
        text: contentText,
      });
    }

    const msgItem: { id: string; type: string; role: string; content: Array<Record<string, unknown>>; status: string } = {
      id: "msg_" + Date.now() + Math.random().toString(36).slice(2, 6),
      type: "message",
      role: "assistant",
      content: contentBlocks,
      status,
    };
    output.push(msgItem);
  }

  // 3. Tool calls → separate function_call output items
  const tcs = (message.tool_calls as Array<Record<string, unknown>> | undefined);
  if (tcs) {
    for (const tc of tcs) {
      const fn = tc.function as Record<string, unknown> | undefined;
      output.push({
        id: "fc_" + Date.now() + Math.random().toString(36).slice(2, 4),
        type: "function_call",
        call_id: tc.id,
        name: fn?.name || "",
        arguments: fn?.arguments || "",
        status: "completed",
      });
    }
  }

  // 4. Build response object
  const response: { id: string; object: string; created_at: number; model: string; status: string; output: Array<Record<string, unknown>>; usage?: Record<string, unknown> } = {
    id: respId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status,
    output,
  };

  // 5. Usage mapping
  if (completion.usage) {
    response.usage = mapUsage(completion.usage as Record<string, unknown>);
  }

  return response;
}

/**
 * Maps OpenAI Chat Completions finish_reason to Responses API status.
 * Handles DeepSeek-specific "insufficient_system_resource" → "incomplete".
 */
function mapFinishReason(finishReason: string | undefined): string {
  switch (finishReason) {
    case "stop":
      return "completed";
    case "tool_calls":
      return "completed";
    case "length":
      return "incomplete";
    case "content_filter":
      return "incomplete";
    case "insufficient_system_resource": // DeepSeek-specific
      return "incomplete";
    default:
      return "completed";
  }
}
