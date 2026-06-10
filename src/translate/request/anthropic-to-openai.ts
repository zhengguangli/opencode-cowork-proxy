/**
 * Anthropic Messages → OpenAI Chat Completions request translator.
 *
 * WHEN TO READ THIS FILE: Debugging request translation for /v1/messages,
 * adding support for a new Anthropic content block type, or changing how
 * system prompts / images / tools are mapped.
 */
import { hashSystemPrompt } from '../../cache';

/**
 * Converts an Anthropic image content block to OpenAI image_url format.
 * Supports both URL-based and base64-encoded images.
 * Returns null if no source is found.
 */
function translateImageBlock(part: Record<string, unknown>): Record<string, unknown> | null {
  const src = part.source as Record<string, unknown> | undefined;
  if (!src) return null;
  if (src.type === "url") {
    return { type: "image_url", image_url: { url: src.url } };
  }
  if (src.type === "base64") {
    return { type: "image_url", image_url: { url: `data:${src.media_type};base64,${src.data}` } };
  }
  return null;
}

export function formatAnthropicToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  const { model, messages, system, temperature, max_tokens, top_p, top_k, tool_choice, stop_sequences, tools, stream, metadata, thinking } = body;

  const openAIMessages = Array.isArray(messages)
    ? messages.flatMap((msg: Record<string, unknown>) => {
        if (typeof msg.content === "string") {
          return [{ role: msg.role, content: msg.content }];
        }
        if (!Array.isArray(msg.content)) return [];

        const result: Array<Record<string, unknown>> = [];

        if (msg.role === "assistant") {
          const assistantMsg: { role: string; content: string | null; reasoning_content?: string; tool_calls?: Array<Record<string, unknown>> } = { role: "assistant", content: null };
          let text = "";
          let reasoningContent = "";
          const toolCalls: Array<Record<string, unknown>> = [];

          (msg.content as Record<string, unknown>[]).forEach((part) => {
            if (part.type === "text") {
              text += (typeof part.text === "string" ? part.text : JSON.stringify(part.text)) + "\n";
            } else if (part.type === "thinking") {
              reasoningContent += (typeof part.thinking === "string" ? part.thinking : JSON.stringify(part.thinking)) + "\n";
            } else if (part.type === "tool_use") {
              toolCalls.push({
                id: part.id,
                type: "function",
                function: { name: part.name, arguments: part.input != null ? (typeof part.input === "string" ? part.input : JSON.stringify(part.input)) : "{}" },
              });
            }
          });

          const trimmed = text.trim();
          const trimmedReasoning = reasoningContent.trim();
          if (trimmed) assistantMsg.content = trimmed;
          if (trimmedReasoning) assistantMsg.reasoning_content = trimmedReasoning;
          if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
          if (assistantMsg.content || assistantMsg.reasoning_content || assistantMsg.tool_calls) result.push(assistantMsg);
        }

        if (msg.role === "user") {
          let userText = "";
          const contentParts: Array<Record<string, unknown>> = [];
          const toolResults: Array<Record<string, unknown>> = [];

          (msg.content as Record<string, unknown>[]).forEach((part) => {
            if (part.type === "text") {
              userText += (typeof part.text === "string" ? part.text : JSON.stringify(part.text)) + "\n";
            } else if (part.type === "image") {
              const translated = translateImageBlock(part);
              if (translated) contentParts.push(translated);
            } else if (part.type === "tool_result") {
              toolResults.push({
                role: "tool",
                tool_call_id: part.tool_use_id,
                content: typeof part.content === "string" ? part.content : JSON.stringify(part.content),
              });
            }
          });

          const trimmed = userText.trim();

          result.push(...toolResults);

          if (contentParts.length > 0) {
            if (trimmed) contentParts.unshift({ type: "text", text: trimmed });
            result.push({ role: "user", content: contentParts });
          } else if (trimmed) {
            result.push({ role: "user", content: trimmed });
          }
        }

        return result;
      })
    : [];

  const systemMessages = Array.isArray(system)
    ? (system as Record<string, unknown>[]).map((item) => ({ role: "system", content: item.text }))
    : system ? [{ role: "system", content: system }] : [];

  const data: Record<string, unknown> = {
    model,
    messages: [...systemMessages, ...openAIMessages],
  };

  if (max_tokens !== undefined) data.max_tokens = max_tokens;
  if (temperature !== undefined) data.temperature = temperature;
  if (top_p !== undefined) data.top_p = top_p;
  if (top_k !== undefined) data.top_k = top_k;
  if (stream !== undefined) data.stream = stream;
  if (stream) data.stream_options = { include_usage: true };
  if (stop_sequences) data.stop = stop_sequences;

  // Map Anthropic metadata.user_id to OpenAI user field
  if (metadata?.user_id) data.user = metadata.user_id;

  // Passthrough thinking config (DeepSeek-specific)
  if (thinking !== undefined) data.thinking = thinking;

  if (tools) {
    data.tools = (tools as Record<string, unknown>[]).map((item) => ({
      type: "function",
      function: {
        name: item.name,
        description: item.description,
        parameters: item.input_schema,
      },
    }));
  }

  // Map tool_choice from Anthropic to OpenAI format
  if (tool_choice != null) {
    if (typeof tool_choice === "string") {
      // "auto" → "auto", "any" → "required", "none" → "none"
      data.tool_choice = tool_choice === "any" ? "required" : tool_choice;
    } else if (tool_choice.type === "auto" || tool_choice.type === "any") {
      data.tool_choice = tool_choice.type === "any" ? "required" : tool_choice.type;
    } else if (tool_choice.type === "tool") {
      // Anthropic {type: "tool", name: "xxx"} → OpenAI {type: "function", function: {name: "xxx"}}
      data.tool_choice = { type: "function", function: { name: tool_choice.name } };
    }
  }

  // Inject prompt_cache_key from system prompt hash for OpenAI node affinity caching.
  // This ensures requests with the same system prompt are routed to the same backend
  // node, enabling automatic OpenAI-style prefix caching.
  const cacheKey = hashSystemPrompt(system);
  if (cacheKey) {
    data.prompt_cache_key = cacheKey;
  }

  return data;
}
