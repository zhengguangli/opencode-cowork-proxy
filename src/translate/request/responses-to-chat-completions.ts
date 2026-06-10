/**
 * OpenAI Responses API → Chat Completions request translator.
 *
 * WHEN TO READ THIS FILE: Debugging /v1/responses translation, adding DeepSeek
 * specific quirks, adding support for new response input item types (e.g.
 * file, web_search), or changing the thinking/max_tokens mapping.
 *
 * Maps /v1/responses format to /chat/completions format, handling:
 * - input as string or array of items
 * - DeepSeek reasoning_content when merging type:"reasoning" + type:"message"(assistant)
 * - tool_choice for function_call tools
 */

export function formatResponsesToChatCompletions(body: Record<string, unknown>): Record<string, unknown> {
  const { model, input, instructions, temperature, max_output_tokens, top_p, top_k, stream, stream_options, tools, tool_choice, parallel_tool_calls, user, text, prompt_cache_key, top_logprobs, thinking, store } = body;

  const messages: Array<Record<string, unknown>> = [];
  let hasSystemMessage = false;

  // 1. Parse input → messages
  if (typeof input === "string") {
    // Instructions goes first
    if (instructions) {
      messages.push({ role: "system", content: instructions });
    }
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    let pendingReasoning: string | null = null;

    for (const item of input) {
      // Handle reasoning items (DeepSeek) — buffer them for merging with next assistant message
      if (item.type === "reasoning") {
        pendingReasoning = item.reasoning_text || "";
        continue;
      }

      // Handle message items
      if (item.type === "message") {
        const role = item.role; // "user" | "system" | "developer" | "assistant"
        const content = item.content || [];

        // DeepSeek: merge reasoning + assistant message
        if (role === "assistant" && pendingReasoning !== null) {
          const textParts = extractTextParts(content);
          const toolCalls = extractToolCalls(item);
          const assistantMsg: Record<string, unknown> = { role: "assistant" };

          if (textParts) {
            assistantMsg.content = textParts;
          } else {
            assistantMsg.content = null;
          }
          assistantMsg.reasoning_content = pendingReasoning;

          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls;
          }

          messages.push(assistantMsg);
          pendingReasoning = null;
          continue;
        }

        if (role === "system") {
          hasSystemMessage = true;
          messages.push({ role: "system", content: extractTextContent(content) });
        } else if (role === "developer") {
          // Map to "system" — Chat Completions has no "developer" role
          hasSystemMessage = true;
          messages.push({ role: "system", content: extractTextContent(content) });
        } else if (role === "user") {
          messages.push(translateUserContent(content));
        } else if (role === "assistant") {
          messages.push(translateAssistantContent(item));
        }
        continue;
      }

      // Handle function_call_output items → tool messages
      if (item.type === "function_call_output") {
        messages.push({
          role: "tool",
          tool_call_id: ((item as Record<string, unknown>).call_id as string) || "",
          content: ((item as Record<string, unknown>).output as string) || "",
        });
        continue;
      }

      // Handle function_call items → tool_calls within an assistant message
      // The proxy's own response translator outputs tool calls as separate type:"function_call"
      // items. When these come back as input, they must be merged with the preceding
      // assistant message (or create a new one) so that subsequent function_call_output
      // items have a matching assistant tool_calls to pair with.
      if (item.type === "function_call") {
        const toolCall = {
          id: item.call_id || item.id || "",
          type: "function",
          function: {
            name: item.name || "",
            arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
          },
        };
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          const tcs: Record<string, unknown>[] = (lastMsg.tool_calls as Record<string, unknown>[]) || [];
          if (!tcs.some((tc) => tc.id === toolCall.id)) {
            tcs.push(toolCall);
          }
          lastMsg.tool_calls = tcs;
        } else {
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: [toolCall],
          });
        }
        continue;
      }

      // Skip other item types (web_search_call, computer_call, etc.)
    }

    // Push instructions as system message only if no system/developer message already in input
    if (instructions && !hasSystemMessage) {
      messages.unshift({ role: "system", content: instructions });
    }
  }

  // Build Chat Completions request
  const chatReq: Record<string, unknown> = {
    model: model,
    messages,
  };

  if (max_output_tokens !== undefined) chatReq.max_tokens = max_output_tokens;
  if (temperature !== undefined) chatReq.temperature = temperature;
  if (top_p !== undefined) chatReq.top_p = top_p;
  if (top_k !== undefined) chatReq.top_k = top_k;
  if (stream !== undefined) chatReq.stream = stream;
  if (stream_options !== undefined) chatReq.stream_options = stream_options;
  if (parallel_tool_calls !== undefined) chatReq.parallel_tool_calls = parallel_tool_calls;
  if (user !== undefined) chatReq.user = user;
  if (top_logprobs !== undefined) chatReq.top_logprobs = top_logprobs;

  // DeepSeek: passthrough thinking config
  if (thinking !== undefined) {
    chatReq.thinking = thinking;
  }

  // Tools: only map function_call type tools (skip built-in tools)
  if (Array.isArray(tools)) {
    const toolList = tools as Record<string, unknown>[];
    const functionTools = toolList.filter((t) => t.type === "function");
    if (functionTools.length > 0) {
      chatReq.tools = functionTools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters || t.input_schema,
          ...(t.strict !== undefined ? { strict: t.strict } : {}),
        },
      }));
    }
  }

  // Tool choice mapping
  if (tool_choice !== undefined) {
    if (typeof tool_choice === "string") {
      // "auto" | "none" | "required" are shared between APIs
      chatReq.tool_choice = tool_choice;
    } else {
      const tcObj = tool_choice as Record<string, unknown>;
      if (tcObj.type === "function") {
        chatReq.tool_choice = {
          type: "function",
          function: { name: tcObj.name },
        };
      } else {
        // Unmapped types (file_search, web_search, custom, mcp, etc.)
        // — default to "auto" when tools are present, "none" otherwise
        chatReq.tool_choice = Array.isArray(chatReq.tools) && chatReq.tools.length > 0 ? "auto" : "none";
      }
    }
  }

  // Text config → response_format
  if (text && text.type === "json_object") {
    chatReq.response_format = { type: "json_object" };
  }

  // prompt_cache_key passthrough
  if (prompt_cache_key) {
    chatReq.prompt_cache_key = prompt_cache_key;
  }

  // store passthrough (OpenAI-compatible providers)
  if (store !== undefined) {
    chatReq.store = store;
  }

  return chatReq;
}

/**
 * Extracts text from Responses API content blocks.
 * Handles both legacy text blocks (type: "text") and Codex CLI blocks (type: "input_text").
 * When content is a plain string (not array), returns it as-is.
 * See docs/FIXES.md Fix 2 for the input_text background.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Record<string, unknown>[])
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
function extractTextParts(content: unknown): string | null {
  if (Array.isArray(content)) {
    const texts = (content as Record<string, unknown>[])
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
function translateUserContent(content: unknown): Record<string, unknown> {
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

  for (const part of (content as Record<string, unknown>[])) {
    if (part.type === "text" || part.type === "input_text") {
      textParts.push(String(part.text || ""));
    } else if (part.type === "input_image") {
      hasImages = true;
      const src = (part as Record<string, unknown>).image_url || part.source;
      if ((src as Record<string, unknown>)?.url) {
        parts.push({ type: "image_url", image_url: { url: (src as Record<string, unknown>).url } });
      } else if ((src as Record<string, unknown>)?.type === "base64") {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${(src as Record<string, unknown>).media_type};base64,${(src as Record<string, unknown>).data}` },
        });
      }
    } else if (part.type === "image_url") {
      hasImages = true;
      parts.push({ type: "image_url", image_url: { url: (part.image_url as Record<string, unknown>)?.url as string || "" } });
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
function translateAssistantContent(item: Record<string, unknown>): Record<string, unknown> {
  const content = (item.content as Record<string, unknown>[]) || [];
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
function extractToolCalls(item: Record<string, unknown>): Record<string, unknown>[] {
  // Responses API assistant items may have tool_calls attached
  // but in Responses API format, tool calls are separate output items, not embedded
  const content = (item.content as Record<string, unknown>[]) || [];
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
