import { describe, it, expect } from 'vitest';
import { formatResponsesToChatCompletions } from '../src/translate/request/responses-to-chat-completions';
import { formatChatCompletionsToResponses } from '../src/translate/response/chat-completions-to-responses';
import { streamChatCompletionsToResponses } from '../src/translate/stream/chat-completions-to-responses';

// ──────────────────────────────────────────
// Request Translation: Responses API → Chat Completions
// ──────────────────────────────────────────
describe('formatResponsesToChatCompletions (Responses API → Chat Completions request)', () => {
  it('converts a simple string input', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hello',
    });
    expect(result.model).toBe('deepseek-v4-flash');
    expect(result.messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('converts instructions to system message', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Tell me a joke',
      instructions: 'Be funny',
    });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'Be funny' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Tell me a joke' });
  });

  it('converts array input with user message', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-pro',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'What is AI?' }] },
      ],
    });
    expect(result.messages).toEqual([
      { role: 'user', content: 'What is AI?' },
    ]);
  });

  it('converts array input with system message', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-pro',
      input: [
        { type: 'message', role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      ],
    });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('merges instructions + array user message correctly', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
      instructions: 'Be concise',
    });
    expect(result.messages).toEqual([
      { role: 'system', content: 'Be concise' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  // ── DeepSeek: reasoning + assistant message merging ──
  it('merges reasoning + assistant messages (DeepSeek)', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Solve this' }] },
        { type: 'reasoning', reasoning_text: 'Let me think step by step...' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The answer is 42.' }] },
      ],
    });
    expect(result.messages).toEqual([
      { role: 'user', content: 'Solve this' },
      {
        role: 'assistant',
        content: 'The answer is 42.',
        reasoning_content: 'Let me think step by step...',
      },
    ]);
  });

  it('merges reasoning without following assistant message', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'reasoning', reasoning_text: 'Some thinking' },
      ],
    });
    // If no assistant message follows, reasoning is dropped
    expect(result.messages).toEqual([]);
  });

  it('handles reasoning + empty assistant content', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'reasoning', reasoning_text: 'Thinking...' },
        { type: 'message', role: 'assistant', content: [] },
      ],
    });
    expect(result.messages[0]).toEqual({
      role: 'assistant',
      content: null,
      reasoning_content: 'Thinking...',
    });
  });

  // ── Function call output → tool messages ──
  it('converts function_call_output to tool messages', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-pro',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
        { type: 'function_call_output', call_id: 'call_001', output: 'Sunny, 22°C' },
      ],
    });
    expect(result.messages).toEqual([
      { role: 'user', content: 'Weather?' },
      { role: 'tool', tool_call_id: 'call_001', content: 'Sunny, 22°C' },
    ]);
  });

  // Regression: CRITICAL bug 2 from QA report — tool calls dropped in non-DeepSeek Responses API
  // assistant messages. The plain assistant path used to silently drop tool_call content blocks;
  // only the DeepSeek merge path called extractToolCalls. Both paths must now emit tool_calls.
  it('extracts tool_call blocks from non-DeepSeek Responses API assistant messages', () => {
    const result = formatResponsesToChatCompletions({
      model: 'gpt-4-style',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'What is the weather in Paris?' }] },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'Let me check.' },
            { type: 'tool_call', id: 'call_abc', name: 'get_weather', arguments: '{"city":"Paris"}' },
          ],
        },
      ],
    });
    expect(result.messages).toHaveLength(2);
    const assistant = result.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('Let me check.');
    expect(assistant.tool_calls).toEqual([
      { id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
    ]);
  });

  it('returns assistant content as null when only tool_call blocks are present', () => {
    const result = formatResponsesToChatCompletions({
      model: 'gpt-4-style',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Search cats' }] },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'tool_call', id: 'c1', name: 'search', arguments: '{"q":"cats"}' },
          ],
        },
      ],
    });
    const assistant = result.messages[1];
    expect(assistant.content).toBeNull();
    expect(assistant.tool_calls).toHaveLength(1);
  });

  // ── Parameters ──
  it('maps max_output_tokens to max_tokens', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      max_output_tokens: 2048,
    });
    expect(result.max_tokens).toBe(2048);
  });

  it('passes through temperature, top_p, stream', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
    });
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.stream).toBe(true);
  });

  it('passes through prompt_cache_key', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      prompt_cache_key: 'cache-abc123',
    });
    expect(result.prompt_cache_key).toBe('cache-abc123');
  });

  it('maps tools and tool_choice', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-pro',
      input: 'Weather?',
      tools: [
        { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' }, type: 'function' },
      ],
      tool_choice: 'auto',
    });
    expect(result.tools).toEqual([
      { type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } } },
    ]);
    expect(result.tool_choice).toBe('auto');
  });

  it('omits undefined optional parameters', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
    });
    expect(result.temperature).toBeUndefined();
    expect(result.top_p).toBeUndefined();
    expect(result.top_k).toBeUndefined();
    expect(result.stream).toBeUndefined();
    expect(result.store).toBeUndefined();
  });

  // Regression: top_k passthrough — M5 from translation audit
  it('passes through top_k', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      top_k: 50,
    });
    expect(result.top_k).toBe(50);
  });

  it('omits top_k when undefined', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
    });
    expect(result.top_k).toBeUndefined();
  });

  // Regression: store passthrough — M7 from translation audit
  it('passes through store=true', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      store: true,
    });
    expect(result.store).toBe(true);
  });

  it('passes through store=false', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      store: false,
    });
    expect(result.store).toBe(false);
  });

  it('omits store when undefined', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
    });
    expect(result.store).toBeUndefined();
  });

  // ── Image handling ──
  it('handles input_image content blocks', () => {
    const result = formatResponsesToChatCompletions({
      model: 'qwen3.6-plus',
      input: [
        {
          type: 'message', role: 'user',
          content: [
            { type: 'input_image', image_url: { url: 'data:image/png;base64,abc' } },
            { type: 'text', text: 'What is this?' },
          ],
        },
      ],
    });
    expect(Array.isArray(result.messages[0].content)).toBe(true);
    expect(result.messages[0].content[0]).toEqual({ type: 'text', text: 'What is this?' });
    expect(result.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } });
  });

  // Regression: MEDIUM bug 4 from QA report — Base64 input_image.source not handled.
  // The Responses API has a native source-based image format that was previously dropped.
  it('handles input_image with source.type="base64" (native Responses API format)', () => {
    const result = formatResponsesToChatCompletions({
      model: 'qwen3.6-plus',
      input: [
        {
          type: 'message', role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'input_image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
          ],
        },
      ],
    });
    expect(result.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123' },
    });
  });

  // ── System message deduplication ──
  it('deduplicates system messages when both instructions and input system message exist', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'system', content: [{ type: 'text', text: 'System instruction' }] },
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      ],
      instructions: 'Be helpful',
    });
    // Should only have ONE system message from the input, not two
    expect(result.messages.filter((m: any) => m.role === 'system')).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'System instruction' });
  });

  it('uses instructions when no input system message is present', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      ],
      instructions: 'Be concise',
    });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
  });

  // ── Developer role mapping ──
  it('maps developer role to system role for Chat Completions', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'text', text: 'Developer instruction' }] },
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      ],
    });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'Developer instruction' });
  });

  // ── Tool choice fallback ──
  it('falls back to auto for unmapped tool_choice types', () => {
    const result = formatResponsesToChatCompletions({
      model: 'deepseek-v4-pro',
      input: 'Weather?',
      tools: [{ name: 'get_weather', description: 'Get weather', parameters: {}, type: 'function' }],
      tool_choice: { type: 'web_search', name: 'search_tool' },
    });
    expect(result.tool_choice).toBe('auto');
  });
});

// ──────────────────────────────────────────
// Response Translation: Chat Completions → Responses API
// ──────────────────────────────────────────
describe('formatChatCompletionsToResponses (Chat Completions → Responses API response)', () => {
  it('converts a text response', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }, 'deepseek-v4-flash');
    expect(result.object).toBe('response');
    expect(result.id).toMatch(/^resp_/);
    expect(result.model).toBe('deepseek-v4-flash');
    expect(result.status).toBe('completed');
    expect(result.output[0].type).toBe('message');
    expect(result.output[0].status).toBe('completed');
    expect(result.output[0].content[0]).toEqual({ type: 'output_text', text: 'Hello!' });
    expect(result.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    });
  });

  it('converts reasoning_content to reasoning output item (DeepSeek)', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{
        message: { role: 'assistant', reasoning_content: 'internal reasoning', content: 'final answer' },
        finish_reason: 'stop',
      }],
    }, 'deepseek-v4-flash');
    // output[0] should be reasoning, output[1] should be message
    expect(result.output[0].type).toBe('reasoning');
    expect(result.output[0].reasoning_text).toBe('internal reasoning');
    expect(result.output[1].type).toBe('message');
    expect(result.output[1].content[0]).toEqual({ type: 'output_text', text: 'final answer' });
  });

  it('converts tool calls to function_call output items', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_001', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    }, 'deepseek-v4-pro');
    const fcItem = result.output.find((o: any) => o.type === 'function_call');
    expect(fcItem).toBeDefined();
    expect(fcItem.call_id).toBe('call_001');
    expect(fcItem.name).toBe('get_weather');
    expect(fcItem.arguments).toBe('{"city":"Paris"}');
    expect(result.status).toBe('completed');
  });

  it('maps finish_reason "stop" to status "completed"', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
    }, 'test');
    expect(result.status).toBe('completed');
  });

  it('maps finish_reason "length" to status "incomplete"', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{ message: { content: 'truncated' }, finish_reason: 'length' }],
    }, 'test');
    expect(result.status).toBe('incomplete');
  });

  it('maps DeepSeek "insufficient_system_resource" to status "incomplete"', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{ message: { content: 'partial' }, finish_reason: 'insufficient_system_resource' }],
    }, 'deepseek-v4-flash');
    expect(result.status).toBe('incomplete');
  });

  it('handles missing usage gracefully', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
    }, 'test');
    expect(result.usage).toBeUndefined();
  });

  it('maps standard usage with cached_tokens', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 30 },
      },
    }, 'test');
    expect(result.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      input_tokens_details: { cached_tokens: 30 },
    });
  });

  it('maps DeepSeek cache usage (prompt_cache_hit_tokens)', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        total_tokens: 1050,
        prompt_cache_hit_tokens: 400,
        prompt_cache_miss_tokens: 600,
      },
    }, 'deepseek-v4-flash');
    expect(result.usage).toEqual({
      input_tokens: 1000,
      output_tokens: 50,
      total_tokens: 1050,
      input_tokens_details: { cached_tokens: 400 },
    });
  });

  it('maps reasoning tokens in usage', () => {
    const result = formatChatCompletionsToResponses({
      choices: [{ message: { content: 'Hi', reasoning_content: 'thinking' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25,
        completion_tokens_details: { reasoning_tokens: 8 },
      },
    }, 'deepseek-v4-flash');
    expect(result.usage.output_tokens_details).toEqual({ reasoning_tokens: 8 });
  });
});

// ──────────────────────────────────────────
// Stream Translation: Chat Completions SSE → Responses API SSE
// ──────────────────────────────────────────
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
