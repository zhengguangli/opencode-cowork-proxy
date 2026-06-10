/**
 * OpenAI Chat Completions → Anthropic Messages request translator.
 *
 * WHEN TO READ THIS FILE: Debugging request translation for /v1/chat/completions
 * when X-Upstream-Format: anthropic is set, adding support for new OpenAI content
 * parts, or changing the image/tool-call mapping.
 */

import { asRecordArray, asRecordOptional, asRecord } from '../type-guards';

/**
 * Safely parses a tool call arguments JSON string.
 * Returns empty object on parse failure or non-object input.
 * Guards against malformed arguments from upstream providers.
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

/**
 * Converts an OpenAI image URL (data URI or plain URL) to Anthropic image source format.
 * Detects base64-encoded data URIs and returns the appropriate source type.
 */
function imageSourceFromUrl(url: string | undefined): Record<string, unknown> {
  const match = (url || "").match(/^data:([^;]+);base64,(.*)$/);
  if (match) {
    return { type: "base64", media_type: match[1], data: match[2] };
  }
  return { type: "url", url: url || "" };
}

export function formatOpenAIToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const { model, messages, temperature, max_tokens, top_p, stop, tools, stream, tool_choice, response_format, user } = body;

  // Separate system messages from conversation
  const systemMessages: string[] = [];
  const conversationMessages: Array<Record<string, unknown>> = [];
  const msgList = asRecordArray(messages);

  for (const msg of msgList) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        systemMessages.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        msg.content.forEach((part: Record<string, unknown>) => {
          if (part.type === "text") systemMessages.push(part.text as string);
        });
      }
    } else {
      conversationMessages.push(msg);
    }
  }

  // Convert OpenAI messages to Anthropic format
  const anthropicMessages: Array<Record<string, unknown>> = [];

  for (let i = 0; i < conversationMessages.length; i++) {
    const msg = conversationMessages[i];

    if (msg.role === "user") {
      const content: Array<Record<string, unknown>> = [];

      if (typeof msg.content === "string") {
        content.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        asRecordArray(msg.content).forEach((part: Record<string, unknown>) => {
          if (part.type === "text") {
            content.push({ type: "text", text: part.text as string });
          } else if (part.type === "image_url") {
            const imageUrl = asRecordOptional(part.image_url);
            content.push({
              type: "image",
              source: imageSourceFromUrl(imageUrl?.url as string | undefined),
            });
          }
        });
      }

      // Collect tool results from immediately following tool messages
      const nextMsg = conversationMessages[i + 1];
      if (nextMsg && nextMsg.role === "tool") {
        i++; // consume the tool message

        // If there are consecutive tool messages, collect them all
        const toolMessages = [nextMsg];
        while (i + 1 < conversationMessages.length && conversationMessages[i + 1].role === "tool") {
          toolMessages.push(conversationMessages[++i]);
        }

        for (const toolMsg of toolMessages) {
          content.push({
            type: "tool_result",
            tool_use_id: toolMsg.tool_call_id,
            content: typeof toolMsg.content === "string"
              ? toolMsg.content
              : JSON.stringify(toolMsg.content),
          });
        }
      }

      anthropicMessages.push({ role: "user", content });
    } else if (msg.role === "tool") {
      // Standalone tool message (not immediately after a user message).
      // Convert to a user message with tool_result blocks.
      // Collect consecutive tool messages.
      const toolMessages = [msg];
      while (i + 1 < conversationMessages.length && conversationMessages[i + 1].role === "tool") {
        toolMessages.push(conversationMessages[++i]);
      }
      const content: Record<string, unknown>[] = toolMessages.map((toolMsg: Record<string, unknown>) => ({
        type: "tool_result",
        tool_use_id: toolMsg.tool_call_id,
        content: typeof toolMsg.content === "string"
          ? toolMsg.content
          : JSON.stringify(toolMsg.content),
      }));
      anthropicMessages.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const content: Record<string, unknown>[] = [];

      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }

      if (msg.tool_calls) {
        for (const tc of asRecordArray(msg.tool_calls)) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function?.name,
            input: parseToolArguments(tc.function?.arguments),
          });
        }
      }

      if (content.length > 0) {
        anthropicMessages.push({ role: "assistant", content });
      }
    }
  }

  // Build Anthropic request
  const anthropicRequest: Record<string, unknown> = {
    model,
    messages: anthropicMessages,
    max_tokens: max_tokens || 4096,
    stream,
  };

  if (systemMessages.length > 0) {
    anthropicRequest.system = systemMessages.length === 1
      ? systemMessages[0]
      : systemMessages;
  }

  if (temperature !== undefined) {
    anthropicRequest.temperature = temperature;
  }

  if (top_p !== undefined) {
    anthropicRequest.top_p = top_p;
  }

  if (stop) {
    anthropicRequest.stop_sequences = Array.isArray(stop) ? stop : [stop];
  }

  if (tools) {
    anthropicRequest.tools = asRecordArray(tools).map((t) => ({
      name: asRecord(t.function)?.name || t.name,
      description: asRecord(t.function)?.description || t.description,
      input_schema: asRecord(t.function)?.parameters || t.input_schema || { type: "object", properties: {} },
    }));
  }

  // Passthrough additional fields for upstream providers that support them
  if (tool_choice !== undefined) {
    const tc = tool_choice ? asRecord(tool_choice) : null;
    if (tc && tc.type === "function") {
      // OpenAI: {type:"function", function:{name:"xxx"}} → Anthropic: {type:"tool", name:"xxx"}
      const fn = asRecordOptional(tc.function);
      anthropicRequest.tool_choice = fn?.name
        ? { type: "tool", name: fn.name }
        : { type: "tool" };
    } else if (typeof tool_choice === "string") {
      // OpenAI "required" → Anthropic "any"; "auto" and "none" are shared
      const anthyMap: Record<string, string> = { auto: "auto", none: "none", required: "any" };
      anthropicRequest.tool_choice = anthyMap[tool_choice] || tool_choice;
    } else {
      anthropicRequest.tool_choice = tool_choice;
    }
  }
  if (response_format !== undefined) anthropicRequest.response_format = response_format;
  if (user !== undefined) anthropicRequest.metadata = { ...(anthropicRequest.metadata || {}), user_id: user };

  return anthropicRequest;
}
