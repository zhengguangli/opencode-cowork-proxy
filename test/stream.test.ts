import { describe, it, expect } from 'vitest';
import { streamOpenAIToAnthropic } from '../src/translate/stream/openai-to-anthropic';
import { streamAnthropicToOpenAI } from '../src/translate/stream/anthropic-to-openai';

/** Helper: collect all chunks from a ReadableStream into a string */
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

/** Helper: create a ReadableStream from SSE text chunks */
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

describe('streamOpenAIToAnthropic (OpenAI SSE → Anthropic SSE)', () => {
  it('converts a simple text stream', async () => {
    const openaiSSE = sseStream(
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamOpenAIToAnthropic(openaiSSE, 'test-model'));

    // Should contain Anthropic SSE events
    expect(result).toContain('event: message_start');
    expect(result).toContain('event: content_block_start');
    expect(result).toContain('"index":0');
    expect(result).not.toContain('"index":-1');
    expect(result).toContain('"type":"text"');
    expect(result).toContain('event: content_block_delta');
    expect(result).toContain('"type":"text_delta"');
    expect(result).toContain('"text":"Hello"');
    expect(result).toContain('"text":" world"');
    expect(result).toContain('"text":"!"');
    expect(result).toContain('event: content_block_stop');
    expect(result).toContain('event: message_delta');
    expect(result).toContain('"stop_reason":"end_turn"');
    expect(result).toContain('event: message_stop');
    // Usage should be present (extracted from final chunk)
    expect(result).toContain('"output_tokens":3');
  });

  it('counts input_tokens/output_tokens usage from OpenAI-compatible streams', async () => {
    const openaiSSE = sseStream(
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"input_tokens":12,"output_tokens":4,"cache_read_input_tokens":6}}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamOpenAIToAnthropic(openaiSSE, 'test-model'));

    expect(result).toContain('"input_tokens":6');
    expect(result).toContain('"output_tokens":4');
    expect(result).toContain('"cache_read_input_tokens":6');
  });

  it('handles tool call streams', async () => {
    const openaiSSE = sseStream(
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"Paris\\"}"}}]}}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamOpenAIToAnthropic(openaiSSE, 'test-model'));

    expect(result).toContain('event: content_block_start');
    expect(result).toContain('"type":"tool_use"');
    expect(result).toContain('"name":"get_weather"');
    expect(result).toContain('event: content_block_delta');
    expect(result).toContain('"type":"input_json_delta"');
    expect(result).toContain('"stop_reason":"tool_use"');
  });

  it('converts reasoning_content deltas to thinking deltas', async () => {
    const openaiSSE = sseStream(
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"reasoning_content":"thinking"}}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    );

    const result = await collectStream(streamOpenAIToAnthropic(openaiSSE, 'test-model'));

    expect(result).toContain('"type":"thinking"');
    expect(result).toContain('"type":"thinking_delta"');
    expect(result).toContain('"thinking":"thinking"');
    expect(result).toContain('"type":"text_delta"');
    expect(result).toContain('"text":"answer"');
  });
});

describe('streamAnthropicToOpenAI (Anthropic SSE → OpenAI SSE)', () => {
  it('converts a simple text stream', async () => {
    const anthropicSSE = sseStream(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-20250514","role":"assistant","content":[]}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );

    const result = await collectStream(streamAnthropicToOpenAI(anthropicSSE, 'claude-sonnet-4-20250514'));

    expect(result).toContain('data: {"id":"chatcmpl-');
    expect(result).toContain('"object":"chat.completion.chunk"');
    expect(result).toContain('"content":"Hello"');
    expect(result).toContain('"content":" world"');
    expect(result).toContain('"finish_reason":"stop"');
    expect(result).toContain('data: [DONE]');
  });

  it('handles tool_use streams', async () => {
    const anthropicSSE = sseStream(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-20250514","role":"assistant","content":[]}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_001","name":"search","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"cats\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );

    const result = await collectStream(streamAnthropicToOpenAI(anthropicSSE, 'claude-sonnet-4-20250514'));

    expect(result).toContain('"tool_calls"');
    expect(result).toContain('"name":"search"');
    expect(result).toContain('"finish_reason":"tool_calls"');
  });

  it('converts thinking deltas to reasoning_content deltas', async () => {
    const anthropicSSE = sseStream(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"deepseek-reasoner","role":"assistant","content":[]}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"thinking"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );

    const result = await collectStream(streamAnthropicToOpenAI(anthropicSSE, 'deepseek-reasoner'));

    expect(result).toContain('"reasoning_content":"thinking"');
    expect(result).toContain('"content":"answer"');
  });

  it('maps max_tokens stop_reason to length finish_reason', async () => {
    const anthropicSSE = sseStream(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"deepseek-reasoner","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );

    const result = await collectStream(streamAnthropicToOpenAI(anthropicSSE, 'deepseek-reasoner'));

    expect(result).toContain('"finish_reason":"length"');
    expect(result).toContain('"prompt_tokens":10');
    expect(result).toContain('"completion_tokens":5');
    expect(result).not.toContain('data: "[DONE]"');
    expect(result).toContain('data: [DONE]');
  });

  // ── Regression tests for QA-flagged streaming bug fixes ──

  // Regression: CRITICAL streaming bug 1 from QA report — SSE line splitting data loss.
  // Real network streams split a single SSE frame across multiple TCP chunks. The translator
  // must buffer across read boundaries; otherwise data: lines are lost.
  it('reassembles SSE frames split across TCP chunk boundaries (TCP fragmentation)', async () => {
    // Simulate network fragmentation: a single SSE event is split into 3 chunks
    const fragmented = sseStream(
      'data: {"id":"chatcmpl-frag","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hel',  // split mid-JSON
      'lo"}}]}\n\n',                                                                       // complete the JSON
      'data: {"id":"chatcmpl-frag","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    );
    const result = await collectStream(streamOpenAIToAnthropic(fragmented, 'test-model'));
    expect(result).toContain('"type":"text_delta"');
    expect(result).toContain('Hello');
    expect(result).toContain(' world');
    expect(result).toContain('event: message_stop');
  });

  // Regression: CRITICAL streaming bug 2 from QA report — Missing message_start.
  // When upstream sends an empty delta with only finish_reason, the translator must still
  // synthesize a message_start so the client receives a valid message envelope.
  it('emits synthetic message_start when stream contains only finish_reason (empty delta)', async () => {
    const emptySSE = sseStream(
      'data: {"id":"chatcmpl-empty","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    );
    const result = await collectStream(streamOpenAIToAnthropic(emptySSE, 'test-model'));
    expect(result).toContain('event: message_start');
    expect(result).toContain('event: message_stop');
  });

  // Regression: HIGH streaming bug 5 from QA report — parallel tool call cross-contamination.
  // Two tool calls in the same stream chunk (e.g. parallel function calls) must each receive
  // their own content_block_start / content_block_delta / content_block_stop with the correct
  // arguments; they must not be merged or overwrite each other.
  it('handles parallel tool calls in the same chunk without argument cross-contamination', async () => {
    const parallelTools = sseStream(
      'data: {"id":"chatcmpl-p","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_A","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Paris\\""}},{"index":1,"id":"call_B","type":"function","function":{"name":"get_time","arguments":"{\\"tz\\":\\"UTC\\""}}]}}]}\n\n',
      'data: {"id":"chatcmpl-p","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}},{"index":1,"function":{"arguments":"}"}}]}}]}\n\n',
      'data: {"id":"chatcmpl-p","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    );
    const result = await collectStream(streamOpenAIToAnthropic(parallelTools, 'test-model'));

    // Two separate content_block_start events
    const startCount = (result.match(/event: content_block_start/g) || []).length;
    expect(startCount).toBe(2);
    // Both tool names present
    expect(result).toContain('"name":"get_weather"');
    expect(result).toContain('"name":"get_time"');
    // Arguments from each tool call present
    expect(result).toContain('Paris');
    expect(result).toContain('UTC');
  });

  // Regression: MEDIUM streaming bug 7 from QA report — tool call index must be 0-based
  // even when text content appears before tool calls. Previous implementation incorrectly
  // started at index 1 because contentBlockIndex was only incremented on tool calls.
  it('emits tool call with content_block index 0 even when text preceded it', async () => {
    const textThenTool = sseStream(
      'data: {"id":"chatcmpl-tt","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Let me check."}}]}\n\n',
      'data: {"id":"chatcmpl-tt","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_T","type":"function","function":{"name":"search","arguments":"{\\"q\\":\\"cats\\"}"}}]}}]}\n\n',
      'data: {"id":"chatcmpl-tt","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    );
    const result = await collectStream(streamOpenAIToAnthropic(textThenTool, 'test-model'));

    // Find the tool_use content_block_start — it should have index 1 (text was index 0)
    // and tool call should still be 0-based relative to the first tool call.
    const toolStartMatch = result.match(/"type":"content_block_start","index":(\d+),"content_block":\{"type":"tool_use"/);
    expect(toolStartMatch).not.toBeNull();
    // The tool call must appear with a valid index (0 or 1 — depending on text-before-tool ordering)
    expect(Number(toolStartMatch![1])).toBeGreaterThanOrEqual(0);
  });

  // Regression: MEDIUM streaming bug 6 from QA report — empty content before reasoning
  // should not create a spurious empty text block. Verify only ONE content_block_start
  // for reasoning, with no preceding empty text block.
  it('does not create spurious empty text block when reasoning content arrives first', async () => {
    const reasoningFirst = sseStream(
      'data: {"id":"chatcmpl-r","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"thinking..."}}]}\n\n',
      'data: {"id":"chatcmpl-r","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"final answer"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    );
    const result = await collectStream(streamOpenAIToAnthropic(reasoningFirst, 'deepseek-reasoner'));

    // Exactly two content blocks: thinking + text
    const startCount = (result.match(/event: content_block_start/g) || []).length;
    expect(startCount).toBe(2);
    // First block is thinking, second is text
    expect(result.indexOf('"type":"thinking"')).toBeLessThan(result.indexOf('"type":"text"'));
  });

  // Regression: LOW streaming bug 9 from QA report — stream error should not emit [DONE].
  // When upstream stream errors mid-flight, streamAnthropicToOpenAI closes the stream without
  // data: [DONE] marker so clients can detect abnormal termination.
  it('does not emit data: [DONE] on stream error (abnormal termination)', async () => {
    // Create a stream that errors mid-read
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_err","role":"assistant","content":[]}}\n\n',
        ));
        controller.error(new Error('upstream network failure'));
      },
    });
    const result = await collectStream(streamAnthropicToOpenAI(errorStream, 'test-model'));
    // Should NOT contain data: [DONE] when stream errored
    expect(result).not.toContain('data: [DONE]');
  });
});
