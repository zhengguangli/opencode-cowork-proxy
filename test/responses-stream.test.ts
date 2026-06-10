import { describe, it, expect } from 'vitest';
import { streamChatCompletionsToResponses } from '../src/translate/stream/chat-completions-to-responses';

/** Helper: collect all events from a ReadableStream into a string */
async function collectStream(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

/** Helper: create a ReadableStream from SSE line chunks */
function sseStream(...chunks: string[]): ReadableStream {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

describe('streamChatCompletionsToResponses (Chat Completions SSE → Responses API SSE)', () => {
  it('converts a simple text stream', async () => {
    const source = sseStream(
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello","role":"assistant"}}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamChatCompletionsToResponses(source, 'test-model'));

    // Should contain Responses API SSE events
    expect(result).toContain('event: response.created');
    expect(result).toContain('event: response.output_item.added');
    expect(result).toContain('event: response.content_part.added');
    expect(result).toContain('event: response.text.delta');
    expect(result).toContain('"delta":"Hello"');
    expect(result).toContain('"delta":" world"');
    expect(result).toContain('event: response.output_item.done');
    expect(result).toContain('event: response.completed');
    expect(result).toContain('"output_tokens":3');
    expect(result).toContain('"status":"completed"');
  });

  it('converts reasoning_content stream (DeepSeek)', async () => {
    const source = sseStream(
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning_content":""}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"reasoning_content":"Some thinking"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"reasoning_content":" process here"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"Final answer"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamChatCompletionsToResponses(source, 'deepseek-v4-flash'));

    // Should have reasoning events
    expect(result).toContain('event: response.output_item.added');
    expect(result).toContain('"type":"reasoning"');
    expect(result).toContain('event: response.reasoning_text.delta');
    expect(result).toContain('"delta":"Some thinking"');
    expect(result).toContain('"delta":" process here"');
    // Should also have text deltas
    expect(result).toContain('event: response.text.delta');
    expect(result).toContain('"delta":"Final answer"');
    // Should end with completed
    expect(result).toContain('event: response.completed');
    expect(result).toContain('"status":"completed"');
  });

  it('converts tool call stream', async () => {
    const source = sseStream(
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"Paris\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamChatCompletionsToResponses(source, 'test-model'));

    expect(result).toContain('event: response.created');
    expect(result).toContain('"type":"function_call"');
    expect(result).toContain('"name":"get_weather"');
    expect(result).toContain('event: response.function_call_arguments.delta');
    expect(result).toContain('"arguments":"{\\"city\\":\\"Paris\\"}"');
    expect(result).toContain('event: response.completed');
    expect(result).toContain('"status":"completed"');
  });

  it('includes usage in completion event', async () => {
    const source = sseStream(
      'data: {"choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamChatCompletionsToResponses(source, 'test-model'));

    expect(result).toContain('"input_tokens":10');
    expect(result).toContain('"output_tokens":5');
  });

  it('handles stream with no content (empty response)', async () => {
    const source = sseStream(
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamChatCompletionsToResponses(source, 'test-model'));

    // No output items emitted during stream → no response.created event
    expect(result).not.toContain('event: response.created');
    expect(result).toContain('event: response.completed');
    // Synthetic empty text item created because finish_reason was present with no output
    expect(result).toContain('"type":"output_text"');
    expect(result).toContain('"text":""');
  });
});
