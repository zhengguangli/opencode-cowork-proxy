/**
 * Converts OpenAI Responses API request to OpenAI Chat Completions request.
 *
 * Maps /v1/responses format to /chat/completions format, handling:
 * - input as string or array of items
 * - DeepSeek reasoning_content when merging type:"reasoning" + type:"message"(assistant)
 * - tool_choice for function_call tools
 */

export function formatResponsesToChatCompletions(body: any): any {
  const { model, input, instructions, temperature, max_output_tokens, top_p, stream, stream_options, tools, tool_choice, parallel_tool_calls, user, text, prompt_cache_key, top_logprobs, thinking } = body;

  const messages: any[] = [];
  let hasSystemMessage = false;

  // 1. Instructions → potential system message
  if (instructions) {
    // Will be pushed later if no input system message found
  }

  // 2. Parse input → messages
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
          const assistantMsg: any = { role: "assistant" };

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
          tool_call_id: item.call_id || "",
          content: typeof item.output === "string" ? item.output : JSON.stringify(item.output),
        });
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
  const chatReq: any = {
    model: model,
    messages,
  };

  if (max_output_tokens !== undefined) chatReq.max_tokens = max_output_tokens;
  if (temperature !== undefined) chatReq.temperature = temperature;
  if (top_p !== undefined) chatReq.top_p = top_p;
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
    const functionTools = tools.filter((t: any) => t.type === "function");
    if (functionTools.length > 0) {
      chatReq.tools = functionTools.map((t: any) => ({
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
    } else if (tool_choice.type === "function") {
      chatReq.tool_choice = {
        type: "function",
        function: { name: tool_choice.name },
      };
    } else {
      // Unmapped types (file_search, web_search, custom, mcp, etc.)
      // — default to "auto" when tools are present, "none" otherwise
      chatReq.tool_choice = Array.isArray(chatReq.tools) && chatReq.tools.length > 0 ? "auto" : "none";
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

  return chatReq;
}

function extractTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text || "")
      .join("\n");
  }
  return "";
}

function extractTextParts(content: any): string | null {
  if (Array.isArray(content)) {
    const texts = content
      .filter((p: any) => p.type === "output_text")
      .map((p: any) => p.text || "");
    return texts.length > 0 ? texts.join("\n") : null;
  }
  return null;
}

function translateUserContent(content: any): any {
  if (typeof content === "string") {
    return { role: "user", content };
  }

  if (!Array.isArray(content)) {
    return { role: "user", content: "" };
  }

  // Check if there are image content blocks
  const hasImages = content.some(
    (p: any) => p.type === "input_image" || p.type === "image_url"
  );

  if (hasImages) {
    const parts: any[] = [];
    for (const part of content) {
      if (part.type === "text") {
        parts.push({ type: "text", text: part.text || "" });
      } else if (part.type === "input_image") {
        const src = part.image_url || part.source;
        if (src?.url) {
          parts.push({ type: "image_url", image_url: { url: src.url } });
        }
      } else if (part.type === "image_url") {
        parts.push({ type: "image_url", image_url: { url: part.image_url?.url || "" } });
      }
    }
    return { role: "user", content: parts };
  }

  // Plain text content
  const plainText = content
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text || "")
    .join("\n");
  return { role: "user", content: plainText || "" };
}

function translateAssistantContent(item: any): any {
  const content = item.content || [];
  const text = content
    .filter((p: any) => p.type === "output_text")
    .map((p: any) => p.text || "")
    .join("\n");

  const assistantMsg: any = { role: "assistant" };
  // Always set content (null if no text, for tool call responses)
  assistantMsg.content = text || null;

  return assistantMsg;
}

function extractToolCalls(item: any): any[] {
  // Responses API assistant items may have tool_calls attached
  // but in Responses API format, tool calls are separate output items, not embedded
  const content = item.content || [];
  return content
    .filter((p: any) => p.type === "function_call_output" || p.type === "tool_call")
    .map((p: any) => {
      if (p.type === "function_call_output") return null;
      if (p.type === "tool_call") {
        return {
          id: p.id,
          type: "function",
          function: {
            name: p.name || "",
            arguments: typeof p.arguments === "string" ? p.arguments : JSON.stringify(p.arguments || {}),
          },
        };
      }
      return null;
    })
    .filter(Boolean);
}
