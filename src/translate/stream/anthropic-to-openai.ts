/**
 * Anthropic Messages SSE → OpenAI Chat Completions SSE stream translator.
 *
 * WHEN TO READ THIS FILE: Debugging streaming response issues for /v1/messages,
 * adding support for new Anthropic stream event types, or changing the SSE format.
 */
import { log } from '../../logger';
import { applyBackpressure } from '../../backpressure';

export function streamAnthropicToOpenAI(anthropicStream: ReadableStream, model: string): ReadableStream {
  const startTime = Math.floor(Date.now() / 1000);
  const chatId = "chatcmpl-" + startTime;
  const sseEncoder = new TextEncoder();
  const decoder = new TextDecoder();

  const enqueueSSE = (controller: ReadableStreamDefaultController, data: Record<string, unknown>) => {
    controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  return new ReadableStream({
    async start(controller) {
      const reader = anthropicStream.getReader();
      let buffer = "";

      // Tool call tracking: contentBlockIndex → { id, name, args, toolCallIndex }
      const toolCallMap = new Map<number, { id: string; name: string; args: string; toolCallIndex: number }>();
      let contentBlockIndex = -1;
      let toolCallCounter = 0; // 0-based sequential index for OpenAI tool calls (independent of contentBlockIndex)
      let activeBlockType: "text" | "thinking" | "tool_use" | null = null;

      // Usage tracking from Anthropic events
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheCreateTokens = 0;
      let lastFinishReason: string | undefined;
      let usageForwarded = false;

      function emitChunk(delta: Record<string, unknown>, finishReason?: string, usage?: Record<string, unknown>) {
        const chunk: { id: string; object: string; created: number; model: string; choices: Array<{ index: number; delta: Record<string, unknown>; finish_reason?: string; usage?: Record<string, unknown> }>; usage?: Record<string, unknown> } = {
          id: chatId,
          object: "chat.completion.chunk",
          created: startTime,
          model,
          choices: [{ index: 0, delta }],
        };
        if (finishReason) chunk.choices[0].finish_reason = finishReason;
        if (usage) chunk.usage = usage;
        enqueueSSE(controller, chunk);
      }

      function processEvents(lines: string[]) {
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let evt: Record<string, unknown>;
          try { evt = JSON.parse(raw); } catch { continue; }
          // SSE event shape is known by Anthropic streaming protocol but too dynamic
          // for static typing — using `as any` avoids excessive type-guard verbosity.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e = evt as any;

          switch (e.type) {
            case "message_start":
              contentBlockIndex = -1;
              activeBlockType = null;
              toolCallMap.clear();
              // Capture input tokens and cache stats from the initial message
              if (e.message?.usage) {
                inputTokens = e.message.usage.input_tokens || 0;
                cacheReadTokens = e.message.usage.cache_read_input_tokens || 0;
                cacheCreateTokens = e.message.usage.cache_creation_input_tokens || 0;
              }
              break;

            case "content_block_start": {
              const block = e.content_block;
              contentBlockIndex = e.index;

              if (block?.type === "text") {
                activeBlockType = "text";
              } else if (block?.type === "thinking") {
                activeBlockType = "thinking";
              } else if (block?.type === "tool_use") {
                activeBlockType = "tool_use";
                // Emit the initial tool_call chunk with id, name, empty args
                const tcId = block.id || `call_${Date.now()}`;
                const tcIndex = toolCallCounter++;
                toolCallMap.set(contentBlockIndex, { id: tcId, name: block.name || "", args: "", toolCallIndex: tcIndex });
                emitChunk({
                  tool_calls: [{
                    index: tcIndex,
                    id: tcId,
                    type: "function",
                    function: { name: block.name || "", arguments: "" },
                  }],
                });
              }
              break;
            }

            case "content_block_delta": {
              const delta = e.delta;
              if (delta?.type === "text_delta") {
                emitChunk({ content: delta.text || "" });
              } else if (delta?.type === "thinking_delta") {
                emitChunk({ reasoning_content: delta.thinking || "" });
              } else if (delta?.type === "input_json_delta") {
                // Accumulate and emit tool call argument deltas
                const tc = toolCallMap.get(contentBlockIndex);
                if (tc) {
                  tc.args += delta.partial_json || "";
                  emitChunk({
                    tool_calls: [{
                      index: tc.toolCallIndex,
                      function: { arguments: delta.partial_json || "" },
                    }],
                  });
                }
              }
              break;
            }

            case "content_block_stop":
              activeBlockType = null;
              break;

            case "message_delta": {
              const stopReason = e.delta?.stop_reason;
              if (stopReason) {
                lastFinishReason = stopReason;
                const finishReason = stopReason === "tool_use" ? "tool_calls"
                                   : stopReason === "max_tokens" ? "length"
                                   : "stop";
                // Capture output tokens from message_delta
                if (e.usage?.output_tokens) {
                  outputTokens = e.usage.output_tokens;
                }
                // Emit chunk with both finish_reason and usage when available
                const totalPromptTokens = inputTokens + cacheReadTokens + cacheCreateTokens;
                const usagePayload = (totalPromptTokens > 0 || outputTokens > 0)
                  ? {
                      prompt_tokens: totalPromptTokens,
                      completion_tokens: outputTokens,
                      total_tokens: totalPromptTokens + outputTokens,
                      ...(cacheReadTokens + cacheCreateTokens > 0
                        ? { prompt_tokens_details: { cached_tokens: cacheReadTokens + cacheCreateTokens } }
                        : {}),
                    }
                  : undefined;
                emitChunk({}, finishReason, usagePayload);
                if (usagePayload) usageForwarded = true;
              }
              break;
            }

            case "message_stop":
              // Nothing extra needed
              break;
          }
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Process complete SSE frames (delimited by double newline)
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || ""; // keep incomplete last part

          for (const frame of parts) {
            if (frame.trim()) {
              processEvents(frame.split("\n"));
            }
          }

          await applyBackpressure(controller);
        }

        // Process remaining buffer
        if (buffer.trim()) {
          processEvents(buffer.split("\n"));
        }
      } catch (err) {
        log.error('STREAM', 'streamAnthropicToOpenAI error', { error: err });
        // On error, close without [DONE] to signal abnormal termination
        controller.close();
        reader.releaseLock();
        return;
      }
      reader.releaseLock();

      // Emit usage as a final chunk if captured but never forwarded through message_delta
      if (!usageForwarded && (inputTokens > 0 || outputTokens > 0)) {
        const finishReason = lastFinishReason === "tool_use" ? "tool_calls"
                           : lastFinishReason === "max_tokens" ? "length"
                           : "stop";
        const totalP = inputTokens + cacheReadTokens + cacheCreateTokens;
        emitChunk({}, finishReason, {
          prompt_tokens: totalP,
          completion_tokens: outputTokens,
          total_tokens: totalP + outputTokens,
          ...(cacheReadTokens + cacheCreateTokens > 0
            ? { prompt_tokens_details: { cached_tokens: cacheReadTokens + cacheCreateTokens } }
            : {}),
        });
      }

      // Send [DONE] — raw text, NOT JSON-stringified (OpenAI spec requires data: [DONE])
      controller.enqueue(sseEncoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
