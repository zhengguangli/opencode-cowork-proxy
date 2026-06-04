/**
 * Converts Anthropic Messages streaming SSE to OpenAI Chat Completions streaming SSE.
 */
export function streamAnthropicToOpenAI(anthropicStream: ReadableStream, model: string): ReadableStream {
  const startTime = Math.floor(Date.now() / 1000);
  const chatId = "chatcmpl-" + startTime;
  const sseEncoder = new TextEncoder();

  const enqueueSSE = (controller: ReadableStreamDefaultController, data: any) => {
    controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  return new ReadableStream({
    async start(controller) {
      const reader = anthropicStream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Tool call tracking: contentBlockIndex → { id, name, args, toolCallIndex }
      const toolCallMap = new Map<number, { id: string; name: string; args: string; toolCallIndex: number }>();
      let contentBlockIndex = -1;
      let toolCallCounter = 0; // 0-based sequential index for OpenAI tool calls (independent of contentBlockIndex)
      let activeBlockType: "text" | "thinking" | "tool_use" | null = null;

      // Usage tracking from Anthropic events
      let inputTokens = 0;
      let outputTokens = 0;
      let lastFinishReason: string | undefined;
      let usageForwarded = false;

      function emitChunk(delta: any, finishReason?: string, usage?: any) {
        const chunk: any = {
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

          let evt: any;
          try { evt = JSON.parse(raw); } catch { continue; }

          switch (evt.type) {
            case "message_start":
              contentBlockIndex = -1;
              activeBlockType = null;
              toolCallMap.clear();
              // Capture input tokens from the initial message
              if (evt.message?.usage?.input_tokens) {
                inputTokens = evt.message.usage.input_tokens;
              }
              break;

            case "content_block_start": {
              const block = evt.content_block;
              contentBlockIndex = evt.index;

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
              const delta = evt.delta;
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
              const stopReason = evt.delta?.stop_reason;
              if (stopReason) {
                lastFinishReason = stopReason;
                const finishReason = stopReason === "tool_use" ? "tool_calls"
                                   : stopReason === "max_tokens" ? "length"
                                   : "stop";
                // Capture output tokens from message_delta
                if (evt.usage?.output_tokens) {
                  outputTokens = evt.usage.output_tokens;
                }
                // Emit chunk with both finish_reason and usage when available
                const usagePayload = (inputTokens > 0 || outputTokens > 0)
                  ? { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens }
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

          // Backpressure: if consumer is behind, yield to let them drain
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          processEvents(buffer.split("\n"));
        }
      } catch (err) {
        console.error('streamAnthropicToOpenAI error:', err);
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
        emitChunk({}, finishReason, {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        });
      }

      // Send [DONE] — raw text, NOT JSON-stringified (OpenAI spec requires data: [DONE])
      controller.enqueue(sseEncoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
