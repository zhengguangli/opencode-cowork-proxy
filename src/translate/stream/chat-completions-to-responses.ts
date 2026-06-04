/**
 * Converts OpenAI Chat Completions streaming SSE to OpenAI Responses API streaming SSE.
 *
 * Chat Completions SSE: data: {"choices":[{"index":0,"delta":{...}}]}\n\n
 * Responses API SSE:   event: response.text.delta\ndata: {"type":"...","delta":"..."}\n\n
 *
 * Handles:
 * - Text content → response.text.delta
 * - DeepSeek reasoning_content → response.reasoning_text.delta
 * - Tool calls → function_call output items + function_call_arguments.delta
 * - Usage in final chunk → response.completed
 */
import { mapUsage } from '../../cache';

type ActiveItemType = "text" | "reasoning" | "function_call" | null;

export function streamChatCompletionsToResponses(
  openaiStream: ReadableStream,
  model: string
): ReadableStream {
  const respId = "resp_" + Date.now();
  const msgId = "msg_" + Date.now();
  const createdTime = Math.floor(Date.now() / 1000);

  const sseEncoder = new TextEncoder();
  const enqueueSSE = (
    controller: ReadableStreamDefaultController,
    eventType: string,
    data: any
  ) => {
    controller.enqueue(
      sseEncoder.encode(
        `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
      )
    );
  };

  return new ReadableStream({
    async start(controller) {
      let messageEmitted = false;
      let activeItemType: ActiveItemType = null;
      let activeItemIndex = -1;
      let textAccum = "";
      let reasoningAccum = "";
      let lastUsage: any = null;
      let finishReason: string | null = null;
      let toolCallAccum = new Map<
        number,
        { id: string; name: string; args: string }
      >();

      const outputItems: any[] = [];
      let activeToolCallIndex: number | null = null;

      const reader = openaiStream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function emitCreated() {
        enqueueSSE(controller, "response.created", {
          type: "response.created",
          response: {
            id: respId,
            object: "response",
            created_at: createdTime,
            model,
            status: "in_progress",
            output: [],
          },
        });
        messageEmitted = true;
      }

      function startTextItem() {
        if (!messageEmitted) emitCreated();
        const itemId = msgId + "-" + (activeItemIndex + 1);
        activeItemIndex++;
        const item = {
          id: itemId,
          type: "message" as const,
          role: "assistant",
          content: [],
          status: "in_progress" as const,
        };
        outputItems.push(item);
        enqueueSSE(controller, "response.output_item.added", {
          type: "response.output_item.added",
          item,
        });
        // content_part for output_text
        const part = { type: "output_text" as const, text: "" };
        item.content.push(part);
        enqueueSSE(controller, "response.content_part.added", {
          type: "response.content_part.added",
          part,
          index: activeItemIndex,
        });
        activeItemType = "text";
      }

      function startReasoningItem() {
        if (!messageEmitted) emitCreated();
        const itemId = "rsn_" + Date.now() + "-" + (activeItemIndex + 1);
        activeItemIndex++;
        reasoningAccum = "";
        const item = {
          id: itemId,
          type: "reasoning" as const,
          status: "in_progress" as const,
          reasoning_text: "",
        };
        outputItems.push(item);
        enqueueSSE(controller, "response.output_item.added", {
          type: "response.output_item.added",
          item,
        });
        activeItemType = "reasoning";
      }

      function startToolCallItem(
        index: number,
        id: string,
        name: string
      ) {
        if (!messageEmitted) emitCreated();
        activeItemIndex++;
        const item = {
          id: "fc_" + id,
          type: "function_call" as const,
          call_id: id,
          name,
          arguments: "",
          status: "in_progress" as const,
        };
        outputItems.push(item);
        toolCallAccum.set(index, { id, name, args: "" });
        activeToolCallIndex = index;
        enqueueSSE(controller, "response.output_item.added", {
          type: "response.output_item.added",
          item,
        });
        activeItemType = "function_call";
      }

      function flushActiveItem(isMidStream: boolean = false) {
        if (activeItemType === "text") {
          const item = outputItems[outputItems.length - 1];
          if (item?.type === "message") {
            // Update content blocks with accumulated text
            const textPart = item.content.find(
              (c: any) => c.type === "output_text"
            );
            if (textPart) textPart.text = textAccum;
            enqueueSSE(controller, "response.content_part.done", {
              type: "response.content_part.done",
              index: activeItemIndex,
              part: textPart,
            });
            enqueueSSE(controller, "response.output_item.done", {
              type: "response.output_item.done",
              item: { ...item, status: "completed" },
            });
            item.status = "completed";
            textAccum = "";
          }
        } else if (activeItemType === "reasoning") {
          const item = outputItems[outputItems.length - 1];
          if (item?.type === "reasoning") {
            item.reasoning_text = reasoningAccum;
            enqueueSSE(controller, "response.reasoning_text.done", {
              type: "response.reasoning_text.done",
              text: reasoningAccum,
              index: activeItemIndex,
            });
            enqueueSSE(controller, "response.output_item.done", {
              type: "response.output_item.done",
              item: { ...item, status: "completed" },
            });
            item.status = "completed";
            reasoningAccum = "";
          }
        } else if (activeItemType === "function_call") {
          const item = outputItems[outputItems.length - 1];
          if (item?.type === "function_call") {
            // Mid-stream flushes always use "completed"; only terminal flush uses global finishReason
            const fcStatus = isMidStream ? "completed" : (finishReason === "tool_calls" ? "completed" : "incomplete");
            enqueueSSE(controller, "response.function_call_arguments.done", {
              type: "response.function_call_arguments.done",
              arguments: item.arguments,
              index: activeItemIndex,
            });
            enqueueSSE(controller, "response.output_item.done", {
              type: "response.output_item.done",
              item: { ...item, status: fcStatus },
            });
            item.status = fcStatus;
          }
          // Delete only this tool call's accumulator entry, not all accumulators
          if (activeToolCallIndex !== null) {
            toolCallAccum.delete(activeToolCallIndex);
            activeToolCallIndex = null;
          }
        }
        activeItemType = null;
      }

      function processStreamChunk(parsed: any) {
        // Capture usage from final chunk
        if (parsed.usage) {
          lastUsage = parsed.usage;
        }

        // Capture finish reason
        if (parsed.choices?.[0]?.finish_reason) {
          finishReason = parsed.choices[0].finish_reason;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) return;

        // Handle reasoning_content (DeepSeek) — comes before content
        if (delta.reasoning_content) {
          const isFirst = delta.reasoning_content === "" || (reasoningAccum === "" && activeItemType !== "reasoning");

          if (activeItemType && activeItemType !== "reasoning") {
            flushActiveItem(true);
          }

          if (!isFirst) {
            reasoningAccum += delta.reasoning_content;
            enqueueSSE(controller, "response.reasoning_text.delta", {
              type: "response.reasoning_text.delta",
              delta: delta.reasoning_content,
              index: activeItemIndex,
            });
          } else {
            // First reasoning chunk
            startReasoningItem();
            if (delta.reasoning_content) {
              reasoningAccum = delta.reasoning_content;
              enqueueSSE(controller, "response.reasoning_text.delta", {
                type: "response.reasoning_text.delta",
                delta: delta.reasoning_content,
                index: activeItemIndex,
              });
            }
          }
        }

        // Handle tool calls
        if (delta.tool_calls?.length > 0) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              // New tool call (has id)
              if (activeItemType) flushActiveItem(true);
              startToolCallItem(tc.index, tc.id, tc.function?.name || "");
            }
            if (tc.function?.arguments) {
              // Accumulating arguments (also handle when arguments arrive together with id)
              const acc = toolCallAccum.get(tc.index);
              if (acc) {
                acc.args += tc.function.arguments;
                // Update the output item arguments
                const item = outputItems[outputItems.length - 1];
                if (item?.type === "function_call") {
                  item.arguments = acc.args;
                }
                enqueueSSE(controller, "response.function_call_arguments.delta", {
                  type: "response.function_call_arguments.delta",
                  delta: tc.function.arguments,
                  index: tc.index,
                });
              }
            }
          }
        }

        // Handle text content — skip empty priming chunks to avoid creating spurious items
        const hasTextContent = delta.content !== undefined && delta.content !== null;
        if (hasTextContent) {
          // Skip empty priming content when reasoning is active — prevents premature reasoning flush
          if (activeItemType === "reasoning" && delta.content === "") {
            // Don't flush reasoning for empty priming content
          } else if (activeItemType && activeItemType !== "text") {
            flushActiveItem(true);
          }

          if (delta.content === "" && !activeItemType) {
            // Empty priming chunk — don't create text item yet
          } else if (!activeItemType) {
            startTextItem();
            textAccum = delta.content || "";
          } else {
            textAccum += delta.content || "";
          }

          if (delta.content && activeItemType === "text") {
            enqueueSSE(controller, "response.text.delta", {
              type: "response.text.delta",
              delta: delta.content,
              index: activeItemIndex,
            });
          }
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Process remaining buffer
            if (buffer.trim()) {
              const frames = buffer.split("\n\n");
              for (const frame of frames) {
                if (!frame.trim()) continue;
                const lines = frame.split("\n");
                for (const line of lines) {
                  if (line.trim() && line.startsWith("data: ")) {
                    const data = line.slice(6).trim();
                    if (data === "[DONE]") continue;
                    try {
                      processStreamChunk(JSON.parse(data));
                    } catch {
                      /* parse error */
                    }
                  }
                }
              }
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Split on double newline to handle complete SSE frames
          // (even though OpenAI typically uses single-line data: frames)
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";

          for (const frame of frames) {
            if (!frame.trim()) continue;
            const lines = frame.split("\n");
            for (const line of lines) {
              if (line.trim() && line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") continue;
                try {
                  processStreamChunk(JSON.parse(data));
                } catch {
                  continue;
                }
              }
            }
          }

          // Backpressure: if consumer is behind, yield to let them drain
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      } catch (err) {
        console.error('streamChatCompletionsToResponses error:', err);
        if (activeItemType) {
          flushActiveItem(true);
        }
        // Emit response.incomplete with partial usage
        const finalResponse: any = {
          id: respId,
          object: "response",
          created_at: createdTime,
          model,
          status: "incomplete",
          output: outputItems,
        };
        if (lastUsage) {
          finalResponse.usage = mapUsage(lastUsage);
        }
        enqueueSSE(controller, "response.incomplete", {
          type: "response.incomplete",
          response: finalResponse,
        });
        controller.close();
        reader.releaseLock();
        return;
      }
      reader.releaseLock();

      // Flush final active item
      if (activeItemType) {
        flushActiveItem();
      }

      // If no output items were created (e.g., empty content with finish_reason),
      // synthesize an empty text output item so the response has at least one output
      if (outputItems.length === 0 && finishReason) {
        outputItems.push({
          id: msgId + "-0",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "" }],
          status: "completed",
        });
      }

      // Emit response.completed (or response.failed/incomplete based on finish_reason)
      let status = "completed";
      if (finishReason === "length" || finishReason === "content_filter" || finishReason === "insufficient_system_resource") {
        status = "incomplete";
      }

      const finalResponse: any = {
        id: respId,
        object: "response",
        created_at: createdTime,
        model,
        status,
        output: outputItems,
      };

      // Map usage
      if (lastUsage) {
        finalResponse.usage = mapUsage(lastUsage);
      }

      const terminalEvent = status === "completed" ? "response.completed"
                           : status === "incomplete" ? "response.incomplete"
                           : "response.failed";
      enqueueSSE(controller, terminalEvent, {
        type: terminalEvent,
        response: finalResponse,
      });

      controller.close();
    },
  });
}

