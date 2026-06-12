import { describe, it, expect } from 'vitest';
import { formatResponsesToChatCompletions } from '../src/translate/request/responses-to-chat-completions';

// ──────────────────────────────────────────
// Request Translation: Responses API → Chat Completions
// ──────────────────────────────────────────
describe('formatResponsesToChatCompletions (Responses API → Chat Completions request)', () => {
  it('converts a simple string input', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hello',
    });
    expect(result.model).toBe('deepseek-v4-flash');
    expect(result.messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('converts instructions to system message', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Tell me a joke',
      instructions: 'Be funny',
    });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'Be funny' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Tell me a joke' });
  });

  it('converts array input with user message', () => {
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'reasoning', reasoning_text: 'Some thinking' },
      ],
    });
    // If no assistant message follows, reasoning is dropped
    expect(result.messages).toEqual([]);
  });

  it('handles reasoning + empty assistant content', () => {
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
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

  // ── Top-level function_call items → tool_calls in assistant messages ──
  it('merges function_call item with preceding assistant message', () => {
    // When the proxy's own response translator outputs function_call items separately
    // from the message, they come back as input items. We must merge them.
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash-free',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] },
        { type: 'function_call', call_id: 'call_456', name: 'get_weather', arguments: '{"city":"Paris"}' },
        { type: 'function_call_output', call_id: 'call_456', output: 'Sunny, 22°C' },
      ],
    });
    expect(result.messages).toHaveLength(3);
    expect(result.messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_456', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    });
    expect(result.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_456',
      content: 'Sunny, 22°C',
    });
  });

  it('creates assistant message from function_call when no preceding assistant exists', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash-free',
      input: [
        { type: 'function_call', id: 'fc_789', call_id: 'call_789', name: 'search', arguments: '{"q":"test"}' },
        { type: 'function_call_output', call_id: 'call_789', output: 'results' },
      ],
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_789', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } }],
    });
    expect(result.messages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_789',
      content: 'results',
    });
  });

  it('merges function_call with assistant message even when following a user message', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash-free',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
        { type: 'function_call', call_id: 'call_001', name: 'get_weather', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_001', output: 'Sunny' },
      ],
    });
    expect(result.messages).toHaveLength(3);
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].content).toBeNull();
    expect(result.messages[1].tool_calls).toHaveLength(1);
    expect(result.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_001',
      content: 'Sunny',
    });
  });

  it('avoids duplicate tool_calls when both content tool_call and top-level function_call exist', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash-free',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: '' },
            { type: 'tool_call', id: 'call_xyz', name: 'search', arguments: '{"q":"test"}' },
          ],
        },
        { type: 'function_call', call_id: 'call_xyz', name: 'search', arguments: '{"q":"test"}' },
        { type: 'function_call_output', call_id: 'call_xyz', output: 'done' },
      ],
    });
    expect(result.messages).toHaveLength(3);
    expect(result.messages[1].tool_calls).toHaveLength(1);
    expect(result.messages[1].tool_calls[0].id).toBe('call_xyz');
  });

  // Regression: CRITICAL bug 2 from QA report — tool calls dropped in non-DeepSeek Responses API
  // assistant messages. The plain assistant path used to silently drop tool_call content blocks;
  // only the DeepSeek merge path called extractToolCalls. Both paths must now emit tool_calls.
  it('extracts tool_call blocks from non-DeepSeek Responses API assistant messages', () => {
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      max_output_tokens: 2048,
    });
    expect(result.max_tokens).toBe(2048);
  });

  it('passes through temperature, top_p, stream', () => {
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      prompt_cache_key: 'cache-abc123',
    });
    expect(result.prompt_cache_key).toBe('cache-abc123');
  });

  it('maps tools and tool_choice', () => {
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      top_k: 50,
    });
    expect(result.top_k).toBe(50);
  });

  it('omits top_k when undefined', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
    });
    expect(result.top_k).toBeUndefined();
  });

  // Regression: store passthrough — M7 from translation audit
  it('passes through store=true', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      store: true,
    });
    expect(result.store).toBe(true);
  });

  it('passes through store=false', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
      store: false,
    });
    expect(result.store).toBe(false);
  });

  it('omits store when undefined', () => {
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: 'Hi',
    });
    expect(result.store).toBeUndefined();
  });

  // ── Image handling ──
  it('handles input_image content blocks', () => {
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'system', content: [{ type: 'text', text: 'System instruction' }] },
        { type: 'message', role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      ],
      instructions: 'Be helpful',
    });
    // Should only have ONE system message from the input, not two
    expect(result.messages.filter((m: Record<string, unknown>) => m.role === 'system')).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'System instruction' });
  });

  it('uses instructions when no input system message is present', () => {
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
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
    const result: any = formatResponsesToChatCompletions({
      model: 'deepseek-v4-pro',
      input: 'Weather?',
      tools: [{ name: 'get_weather', description: 'Get weather', parameters: {}, type: 'function' }],
      tool_choice: { type: 'web_search', name: 'search_tool' },
    });
    expect(result.tool_choice).toBe('auto');
  });
});
