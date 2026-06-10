import { asRecordArray, asRecord } from '../type-guards';

/**
 * Shared helper functions for Responses API request translation.
 *
 * WHEN TO READ THIS FILE: Modifying how Responses API content blocks are
 * translated to Chat Completions format, or adding support for new content
 * block types. Used by responses-to-chat-completions.ts.
 */

/**
 * Extracts text from Responses API content blocks.
 * Handles both legacy text blocks (type: "text") and Codex CLI blocks (type: "input_text").
 * When content is a plain string (not array), returns it as-is.
 * See docs/FIXES.md Fix 2 for the input_text background.
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return asRecordArray(content)
      .filter((p) => p.type === "text" || p.type === "input_text")
      .map((p) => String(p.text || ""))
      .join("\n");
  }
  return "";
}

/**
 * Extracts text parts from Responses API content, including output_text (model responses),
 * input_text (Codex CLI messages), and legacy text blocks.
 * Returns concatenated text, or null if no text content exists.
 */
export function extractTextParts(content: unknown): string | null {
  if (Array.isArray(content)) {
    const texts = asRecordArray(content)
      .filter((p) => p.type === "output_text" || p.type === "input_text" || p.type === "text")
      .map((p) => String(p.text || ""));
    return texts.length > 0 ? texts.join("\n") : null;
  }
  return null;
}

/**
 * Translates a Responses API user input item to a Chat Completions user message.
 * Handles: plain strings, multi-part arrays with text + images (input_image/image_url),
 * and input_text blocks. Single-pass image detection avoids double iteration.
 */
export function translateUserContent(content: unknown): Record<string, unknown> {
  if (typeof content === "string") {
    return { role: "user", content };
  }

  if (!Array.isArray(content)) {
    return { role: "user", content: "" };
  }

  // Single pass: detect images and collect content parts simultaneously
  let hasImages = false;
  const parts: Record<string, unknown>[] = [];
  const textParts: string[] = [];

  for (const part of asRecordArray(content)) {
    if (part.type === "text" || part.type === "input_text") {
      textParts.push(String(part.text || ""));
    } else if (part.type === "input_image") {
      hasImages = true;
      const src = asRecord(part).image_url || part.source;
      const srcObj = asRecord(src);
      if (srcObj?.url) {
        parts.push({ type: "image_url", image_url: { url: srcObj.url } });
      } else if (srcObj?.type === "base64") {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${srcObj.media_type};base64,${srcObj.data}` },
        });
      }
    } else if (part.type === "image_url") {
      hasImages = true;
      parts.push({ type: "image_url", image_url: { url: String(asRecord(part.image_url)?.url ?? "") } });
    }
  }

  if (hasImages) {
    if (textParts.length > 0) {
      parts.unshift({ type: "text", text: textParts.join("\n") });
    }
    return { role: "user", content: parts };
  }

  // Plain text content (no intermediate arrays)
  return { role: "user", content: textParts.join("\n") || "" };
}

/**
 * Translates a Responses API assistant output item to a Chat Completions assistant message.
 * Extracts output_text content and embedded tool calls.
 * Note: tool calls in Responses API are separate output items, not embedded in the message.
 * This function handles the embedded case for providers that embed tool_calls.
 */
export function translateAssistantContent(item: Record<string, unknown>): Record<string, unknown> {
  const content = asRecordArray(item.content);
  const text = content
    .filter((p) => p.type === "output_text")
    .map((p) => String(p.text || ""))
    .join("\n");
  const toolCalls = extractToolCalls(item);

  const assistantMsg: Record<string, unknown> = { role: "assistant" };
  // Always set content (null if no text, for tool call responses)
  assistantMsg.content = text || null;
  if (toolCalls.length > 0) {
    assistantMsg.tool_calls = toolCalls;
  }

  return assistantMsg;
}

/**
 * Extracts tool call blocks from a Responses API assistant item content.
 * Filters out function_call_output (which are tool results, not tool calls).
 * Returns an array of OpenAI-format tool call objects.
 */
export function extractToolCalls(item: Record<string, unknown>): Record<string, unknown>[] {
  // Responses API assistant items may have tool_calls attached
  // but in Responses API format, tool calls are separate output items, not embedded
  const content = asRecordArray(item.content);
  const result: Record<string, unknown>[] = [];
  for (const p of content) {
    if (p.type === "function_call_output") continue;
    if (p.type === "tool_call") {
      result.push({
        id: p.id,
        type: "function",
        function: {
          name: p.name || "",
          arguments: typeof p.arguments === "string" ? p.arguments : JSON.stringify(p.arguments || {}),
        },
      });
    }
  }
  return result;
}
