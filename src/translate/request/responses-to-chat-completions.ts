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

import { asRecordArray, asRecord } from '../type-guards';
import { extractTextContent, extractTextParts, translateUserContent, translateAssistantContent, extractToolCalls } from './responses-helpers';

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
          tool_call_id: String(asRecord(item).call_id ?? ""),
          content: String(asRecord(item).output ?? ""),
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
          const tcs: Record<string, unknown>[] = asRecordArray(lastMsg.tool_calls);
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
    const toolList = asRecordArray(tools);
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
      const tcObj = asRecord(tool_choice);
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
