/**
 * Chat Completions SSE → Responses API SSE stream translator.
 *
 * WHEN TO READ THIS FILE: Debugging /v1/responses streaming issues, adding new
 * stream event types (e.g. response.output_item.done), or modifying DeepSeek
 * specific stream handling and <think> tag stripping.
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
import { log } from '../../logger';
import { ThinkTagStripper } from '../../think-tag-stripper';
import { applyBackpressure } from '../../backpressure';
import { createSseEncoder } from './sse-encoder';
import { parseSseFrame, parseSseBuffer } from './sse-parser';
import { asRecord, asRecordArray, asRecordOptional } from '../type-guards';

type ActiveItemType = "text" | "reasoning" | "function_call" | null;

export function streamChatCompletionsToResponses(
  openaiStream: ReadableStream,
  model: string
): ReadableStream {
  const respId = "resp_" + Date.now();
  const msgId = "msg_" + Date.now();
  const createdTime = Math.floor(Date.now() / 1000);

  const decoder = new TextDecoder();
  const enqueueSSE = createSseEncoder();

  return new ReadableStream({
    async start(controller) {
      let messageEmitted = false;
      let activeItemType: ActiveItemType = null;
      let activeItemIndex = -1;
      let textAccum = "";
      let reasoningAccum = "";
      const tagStripper = new ThinkTagStripper();
      let lastUsage: Record<string, unknown> | null = null;
      let finishReason: string | null = null;
      let toolCallAccum = new Map<
        number,
        { id: string; name: string; args: string }
      >();

      const outputItems: Array<Record<string, unknown>> = [];
      let activeToolCallIndex: number | null = null;

      const reader = openaiStream.getReader();
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
          content: [] as Record<string, unknown>[],
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
            const textPart = (item.content as Record<string, unknown>[] | undefined)?.find(
              (c: Record<string, unknown>) => c.type === "output_text"
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

      // (stateful think tag stripping moved to ThinkTagStripper class in think-tag-stripper.ts)

      function processStreamChunk(parsed: Record<string, unknown>) {
        // Capture usage from final chunk
        if (parsed.usage) {
          lastUsage = parsed.usage as Record<string, unknown>;
        }

        // Capture finish reason
        const firstChoice = asRecordArray(parsed.choices)[0] as Record<string, unknown> | undefined;
        if (firstChoice?.finish_reason) {
          finishReason = (firstChoice as Record<string, unknown>).finish_reason as string;
        }

        const delta: any = firstChoice?.delta;
        if (!delta) return;

        // Stream debug logging is in the handler (handlers/responses.ts)
        // Translate modules are pure — log.debug is gated by IS_DEBUG

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
        // Strip inline <think>...</think> tags from models that embed reasoning in text (e.g., minimax)
        const rawContent = delta.content;
        const cleanedContent = rawContent !== undefined && rawContent !== null
          ? tagStripper.strip(String(rawContent))
          : rawContent;
        const hasTextContent = cleanedContent !== undefined && cleanedContent !== null;
        if (hasTextContent) {
          // Skip empty priming content when reasoning is active — prevents premature reasoning flush
          if (activeItemType === "reasoning" && cleanedContent === "") {
            // Don't flush reasoning for empty priming content
          } else if (activeItemType && activeItemType !== "text") {
            flushActiveItem(true);
          }

          if (cleanedContent === "" && !activeItemType) {
            // Empty priming chunk — don't create text item yet
          } else if (!activeItemType) {
            startTextItem();
            textAccum = cleanedContent || "";
          } else {
            textAccum += cleanedContent || "";
          }

          if (cleanedContent && activeItemType === "text") {
            enqueueSSE(controller, "response.text.delta", {
              type: "response.text.delta",
              delta: cleanedContent,
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
            for (const data of parseSseBuffer(buffer)) {
              try {
                processStreamChunk(JSON.parse(data));
              } catch {
                /* parse error */
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
            for (const data of parseSseFrame(frame)) {
              try {
                processStreamChunk(JSON.parse(data));
              } catch {
                continue;
              }
            }
          }

          await applyBackpressure(controller);
        }
      } catch (err) {
        log.error('STREAM', 'streamChatCompletionsToResponses error', { error: err });
        if (activeItemType) {
          flushActiveItem(true);
        }
        // Emit response.incomplete with partial usage
        const finalResponse: { id: string; object: string; created_at: number; model: string; status: string; output: Array<Record<string, unknown>>; usage?: Record<string, unknown> } = {
          id: respId,
          object: "response",
          created_at: createdTime,
          model,
          status: "incomplete",
          output: outputItems,
        };
        if (lastUsage) {
          finalResponse.usage = mapUsage(asRecord(lastUsage));
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

      const finalResponse: { id: string; object: string; created_at: number; model: string; status: string; output: Array<Record<string, unknown>>; usage?: Record<string, unknown> } = {
        id: respId,
        object: "response",
        created_at: createdTime,
        model,
        status,
        output: outputItems,
      };

      // Map usage
      if (lastUsage) {
        finalResponse.usage = mapUsage(asRecord(lastUsage));
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

