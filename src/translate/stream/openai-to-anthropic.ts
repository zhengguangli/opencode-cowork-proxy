import { extractCachedTokens, extractOutputTokens, extractUncachedInputTokens } from '../../cache';

export function streamOpenAIToAnthropic(openaiStream: ReadableStream, model: string): ReadableStream {
  const messageId = "msg_" + Date.now();
  const sseEncoder = new TextEncoder();

  const enqueueSSE = (controller: ReadableStreamDefaultController, eventType: string, data: any) => {
    controller.enqueue(sseEncoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  return new ReadableStream({
    async start(controller) {
      let contentBlockIndex = -1;
      let hasStartedTextBlock = false;
      let hasStartedThinkingBlock = false;
      let isToolUse = false;
      let activeToolCallId: string | null = null;
      let toolCallIdByOaiIndex = new Map<number, string>(); // OpenAI tool_call index → tool call ID
      let oaiIndexToCbIndex = new Map<number, number>();    // OpenAI tool_call index → content block index
      let toolCallJsonMap = new Map<string, string>();
      let lastUsage: any = null;
      let finishReason: string | null = null;
      let messageStarted = false;

      const reader = openaiStream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function processStreamDelta(delta: any, parsed: any) {
        // Capture usage from any chunk that has it
        if (parsed.usage) {
          lastUsage = {
            input_tokens: extractUncachedInputTokens(parsed.usage),
            output_tokens: extractOutputTokens(parsed.usage),
            cache_read_input_tokens: extractCachedTokens(parsed.usage),
            cache_creation_input_tokens: 0,
          };
        }

        // Capture finish reason
        if (parsed.choices?.[0]?.finish_reason) {
          finishReason = parsed.choices[0].finish_reason;
        }

        // Handle tool calls
        if (delta.tool_calls?.length > 0) {
          for (const toolCall of delta.tool_calls) {
            const isNewDeclaration = !!toolCall.id;

            if (isNewDeclaration) {
              const toolCallId = toolCall.id;

              // Close previous content block if switching types
              if (hasStartedTextBlock || hasStartedThinkingBlock) {
                enqueueSSE(controller, "content_block_stop", {
                  type: "content_block_stop",
                  index: contentBlockIndex,
                });
                hasStartedTextBlock = false;
                hasStartedThinkingBlock = false;
              }

              // Close previous tool call if switching to a different one
              if (isToolUse && activeToolCallId !== toolCallId) {
                enqueueSSE(controller, "content_block_stop", {
                  type: "content_block_stop",
                  index: contentBlockIndex,
                });
              }

              isToolUse = true;
              activeToolCallId = toolCallId;
              contentBlockIndex++;
              toolCallIdByOaiIndex.set(toolCall.index, toolCallId);
              oaiIndexToCbIndex.set(toolCall.index, contentBlockIndex);
              toolCallJsonMap.set(toolCallId, "");

              const toolBlock = {
                type: "tool_use",
                id: toolCallId,
                name: toolCall.function?.name,
                input: {},
              };

              // Send message_start on first content block
              if (!messageStarted) {
                enqueueSSE(controller, "message_start", {
                  type: "message_start",
                  message: {
                    id: messageId,
                    type: "message",
                    role: "assistant",
                    content: [],
                    model,
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 },
                  },
                });
                messageStarted = true;
              }

              enqueueSSE(controller, "content_block_start", {
                type: "content_block_start",
                index: contentBlockIndex,
                content_block: toolBlock,
              });
            }

            // Always process arguments, keyed by OpenAI tool call index
            // (not by a single currentToolCallId pointer)
            if (toolCall.function?.arguments) {
              const tcId = toolCallIdByOaiIndex.get(toolCall.index);
              if (tcId) {
                const currentJson = toolCallJsonMap.get(tcId) || "";
                toolCallJsonMap.set(tcId, currentJson + toolCall.function.arguments);

                const cbIndex = oaiIndexToCbIndex.get(toolCall.index) ?? contentBlockIndex;
                enqueueSSE(controller, "content_block_delta", {
                  type: "content_block_delta",
                  index: cbIndex,
                  delta: {
                    type: "input_json_delta",
                    partial_json: toolCall.function.arguments,
                  },
                });
              }
            }
          }
        }

        if (delta.reasoning_content) {
          if (isToolUse || hasStartedTextBlock) {
            enqueueSSE(controller, "content_block_stop", {
              type: "content_block_stop",
              index: contentBlockIndex,
            });
            isToolUse = false;
            hasStartedTextBlock = false;
            activeToolCallId = null;
            contentBlockIndex++;
          }

          if (!hasStartedThinkingBlock) {
            if (contentBlockIndex < 0) contentBlockIndex = 0;

            if (!messageStarted) {
              enqueueSSE(controller, "message_start", {
                type: "message_start",
                message: {
                  id: messageId,
                  type: "message",
                  role: "assistant",
                  content: [],
                  model,
                  stop_reason: null,
                  stop_sequence: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              });
              messageStarted = true;
            }

            enqueueSSE(controller, "content_block_start", {
              type: "content_block_start",
              index: contentBlockIndex,
              content_block: { type: "thinking", thinking: "", signature: "" },
            });
            hasStartedThinkingBlock = true;
          }

          enqueueSSE(controller, "content_block_delta", {
            type: "content_block_delta",
            index: contentBlockIndex,
            delta: { type: "thinking_delta", thinking: delta.reasoning_content },
          });
        }

        if (delta.content !== undefined && delta.content !== null) {
          // Skip empty priming content — avoid creating spurious empty text block
          // before reasoning or tool use content
          if (delta.content === "" && !hasStartedTextBlock) {
            // Don't create a text block for empty content
          } else {
            if (isToolUse || hasStartedThinkingBlock) {
              enqueueSSE(controller, "content_block_stop", {
                type: "content_block_stop",
                index: contentBlockIndex,
              });
              isToolUse = false;
              hasStartedThinkingBlock = false;
              activeToolCallId = null;
              contentBlockIndex++;
            }

            if (!hasStartedTextBlock) {
              if (contentBlockIndex < 0) contentBlockIndex = 0;

              if (!messageStarted) {
                enqueueSSE(controller, "message_start", {
                  type: "message_start",
                  message: {
                    id: messageId,
                    type: "message",
                    role: "assistant",
                    content: [],
                    model,
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 },
                  },
                });
                messageStarted = true;
              }

              enqueueSSE(controller, "content_block_start", {
                type: "content_block_start",
                index: contentBlockIndex,
                content_block: { type: "text", text: "" },
              });
              hasStartedTextBlock = true;
            }

            if (delta.content) {
              enqueueSSE(controller, "content_block_delta", {
                type: "content_block_delta",
                index: contentBlockIndex,
                delta: { type: "text_delta", text: delta.content },
              });
            }
          }
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              const frames = buffer.split('\n\n');
              for (const frame of frames) {
                if (!frame.trim()) continue;
                const lines = frame.split('\n');
                for (const line of lines) {
                  if (line.trim() && line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    try {
                      const parsed = JSON.parse(data);
                      const delta = parsed.choices?.[0]?.delta;
                      if (delta) processStreamDelta(delta, parsed);
                    } catch { /* parse error */ }
                  }
                }
              }
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Split on double newline to handle TCP fragmentation correctly
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            if (!frame.trim()) continue;
            const lines = frame.split('\n');
            for (const line of lines) {
              if (line.trim() && line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;
                  if (delta) processStreamDelta(delta, parsed);
                } catch { continue; }
              }
            }
          }

          // Backpressure: if consumer is behind, yield to let them drain
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      } catch (err) {
        console.error('streamOpenAIToAnthropic error:', err);
        // Close active content block
        if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
          enqueueSSE(controller, "content_block_stop", {
            type: "content_block_stop",
            index: contentBlockIndex,
          });
        }
        enqueueSSE(controller, "message_delta", {
          type: "message_delta",
          delta: { stop_reason: "max_tokens", stop_sequence: null },
          usage: lastUsage || { input_tokens: 0, output_tokens: 0 },
        });
        enqueueSSE(controller, "message_stop", {
          type: "message_stop",
        });
        controller.close();
        reader.releaseLock();
        return;
      }
      reader.releaseLock();

      // Close last content block
      if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
        enqueueSSE(controller, "content_block_stop", {
          type: "content_block_stop",
          index: contentBlockIndex,
        });
      }

      // Emit synthetic message_start if it was never emitted (e.g., empty delta with finish_reason)
      if (!messageStarted) {
        enqueueSSE(controller, "message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            content: [],
            model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
      }

      // Map finish reason and usage
      let stopReason = "end_turn";
      switch (finishReason) {
        case "tool_calls": stopReason = "tool_use"; break;
        case "length": stopReason = "max_tokens"; break;
        case "stop": stopReason = "end_turn"; break;
        case "content_filter":
        case "insufficient_system_resource":
          stopReason = "max_tokens"; break;
        default: stopReason = "end_turn"; break;
      }

      enqueueSSE(controller, "message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: lastUsage || { input_tokens: 0, output_tokens: 0 },
      });

      enqueueSSE(controller, "message_stop", {
        type: "message_stop",
      });

      controller.close();
    },
  });
}
