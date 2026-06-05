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

/** Strip <think>...</think> blocks from text content (Minimax-style reasoning in content) */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export function formatChatCompletionsToResponses(completion: any, model: string): any {
  const choice = completion.choices?.[0] || {};
  const message = choice.message || {};

  const respId = "resp_" + Date.now() + Math.random().toString(36).slice(2, 6);
  const status = mapFinishReason(choice.finish_reason);
  const output: any[] = [];

  // 1. DeepSeek: reasoning_content → type:"reasoning" output item (before message)
  if (message.reasoning_content) {
    output.push({
      type: "reasoning",
      id: "rsn_" + Date.now(),
      reasoning_text: message.reasoning_content,
    });
  }

  // 2. Content → type:"message" output item with output_text content block
  const contentText = message.content ? stripThinkTags(message.content) : message.content;
  if (contentText || message.tool_calls) {
    const contentBlocks: any[] = [];

    // Text content
    if (contentText) {
      contentBlocks.push({
        type: "output_text",
        text: contentText,
      });
    }

    const msgItem: any = {
      id: "msg_" + Date.now() + Math.random().toString(36).slice(2, 6),
      type: "message",
      role: "assistant",
      content: contentBlocks,
      status,
    };
    output.push(msgItem);
  }

  // 3. Tool calls → separate function_call output items
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      output.push({
        id: "fc_" + Date.now() + Math.random().toString(36).slice(2, 4),
        type: "function_call",
        call_id: tc.id,
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "",
        status: "completed",
      });
    }
  }

  // 4. Build response object
  const response: any = {
    id: respId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status,
    output,
  };

  // 5. Usage mapping
  if (completion.usage) {
    response.usage = mapUsage(completion.usage);
  }

  return response;
}

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
