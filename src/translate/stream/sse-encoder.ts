/**
 * Shared SSE (Server-Sent Events) encoder for stream translators.
 *
 * WHEN TO READ THIS FILE: Creating a new stream translator that emits SSE events,
 * or changing the SSE wire format. Both chat-completions-to-responses and
 * openai-to-anthropic stream translators use this encoder.
 */

export function createSseEncoder() {
  const encoder = new TextEncoder();
  return (
    controller: ReadableStreamDefaultController,
    eventType: string,
    data: Record<string, unknown>,
  ) => {
    controller.enqueue(
      encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  };
}
