import { describe, it, expect } from 'vitest';
import { formatAnthropicToOpenAI } from '../src/translate/request/anthropic-to-openai';

describe('formatAnthropicToOpenAI (Anthropic → OpenAI request)', () => {
  it('converts a simple text message', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
    });
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.max_tokens).toBe(1024);
    expect(result.messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('converts messages with content arrays', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'What is 2+2?' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'The answer is 4.' }] },
      ],
      max_tokens: 1024,
    });
    expect(result.messages).toEqual([
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: 'The answer is 4.' },
    ]);
  });

  it('converts system messages', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('converts array system messages', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      system: [
        { type: 'text', text: 'Rule 1' },
        { type: 'text', text: 'Rule 2' },
      ],
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'Rule 1' });
    expect(result.messages[1]).toEqual({ role: 'system', content: 'Rule 2' });
  });

  it('converts tool_use to tool_calls', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tool_001', name: 'get_weather', input: { city: 'Paris' } },
        ],
      }],
      max_tokens: 1024,
    });
    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].content).toBe('Let me check.');
    expect(result.messages[0].tool_calls).toEqual([
      { id: 'tool_001', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
    ]);
  });

  it('converts thinking blocks to reasoning_content', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'deepseek-reasoner',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: 'final answer' },
        ],
      }],
      max_tokens: 1024,
    });
    expect(result.messages[0].reasoning_content).toBe('internal reasoning');
    expect(result.messages[0].content).toBe('final answer');
  });

  it('converts tool_result to tool messages', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool_001', content: 'Sunny, 22°C' },
        ],
      }],
      max_tokens: 1024,
    });
    expect(result.messages[0]).toEqual({
      role: 'tool', tool_call_id: 'tool_001', content: 'Sunny, 22°C',
    });
  });

  it('puts tool_result messages before user text in mixed Anthropic user turns', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'deepseek-reasoner',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool_001', name: 'search', input: { query: 'cats' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool_001', content: 'cats result' },
            { type: 'text', text: 'Use that result.' },
          ],
        },
      ],
      max_tokens: 1024,
    });
    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tool_001', type: 'function', function: { name: 'search', arguments: '{"query":"cats"}' } }],
      },
      { role: 'tool', tool_call_id: 'tool_001', content: 'cats result' },
      { role: 'user', content: 'Use that result.' },
    ]);
  });

  it('passes through optional parameters', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 4096,
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
      stop_sequences: ['END'],
    });
    expect(result.max_tokens).toBe(4096);
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.stream).toBe(true);
    expect(result.stream_options).toEqual({ include_usage: true });
    expect(result.stop).toEqual(['END']);
  });

  it('requests usage in OpenAI-compatible streams', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 4096,
      stream: true,
    });
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it('omits undefined optional parameters', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.temperature).toBeUndefined();
    expect(result.top_p).toBeUndefined();
    expect(result.stream).toBeUndefined();
  });

  it('converts tools format', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Weather?' }],
      max_tokens: 1024,
      tools: [
        { name: 'get_weather', description: 'Get weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } },
      ],
    });
    expect(result.tools).toEqual([
      { type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } },
    ]);
  });

  it('converts base64 images from Anthropic to OpenAI image_url format', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      }],
      max_tokens: 1024,
    });
    expect(result.messages[0].role).toBe('user');
    expect(Array.isArray(result.messages[0].content)).toBe(true);
    expect(result.messages[0].content).toEqual([
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
    ]);
  });

  it('converts URL images from Anthropic to OpenAI image_url format', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: 'https://example.com/cat.jpg' } },
        ],
      }],
      max_tokens: 1024,
    });
    expect(result.messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } },
    ]);
  });

  it('returns string content when user message has no images', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Hello world' },
        ],
      }],
      max_tokens: 1024,
    });
    expect(result.messages[0].content).toBe('Hello world');
  });

  it('includes text alongside images in array content', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'xyz' } },
        ],
      }],
      max_tokens: 1024,
    });
    expect(result.messages[0].content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xyz' } },
    ]);
  });

  // Regression: top_k passthrough — M5 from translation audit
  it('passes through top_k', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
      top_k: 50,
    });
    expect(result.top_k).toBe(50);
  });

  it('omits top_k when undefined', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.top_k).toBeUndefined();
  });

  // Regression: tool_choice passthrough — M6 from translation audit
  it('maps tool_choice string "auto" unchanged', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
      tool_choice: 'auto',
    });
    expect(result.tool_choice).toBe('auto');
  });

  it('maps tool_choice string "any" to "required"', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
      tool_choice: 'any',
    });
    expect(result.tool_choice).toBe('required');
  });

  it('maps tool_choice string "none" unchanged', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
      tool_choice: 'none',
    });
    expect(result.tool_choice).toBe('none');
  });

  it('maps tool_choice object {type:"auto"} to "auto"', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
      tool_choice: { type: 'auto' },
    });
    expect(result.tool_choice).toBe('auto');
  });

  it('maps tool_choice object {type:"any"} to "required"', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
      tool_choice: { type: 'any' },
    });
    expect(result.tool_choice).toBe('required');
  });

  it('maps tool_choice object {type:"tool", name:"xxx"} to {type:"function", function:{name:"xxx"}}', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
      tools: [
        { name: 'get_weather', description: 'Get weather', input_schema: { type: 'object' } },
      ],
      tool_choice: { type: 'tool', name: 'get_weather' },
    });
    expect(result.tool_choice).toEqual({
      type: 'function',
      function: { name: 'get_weather' },
    });
  });

  it('omits tool_choice when undefined', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.tool_choice).toBeUndefined();
  });
});

// Cache-specific tests (Anthropic→OpenAI direction only, since cache injection is relevant here)
describe('Anthropic→OpenAI prompt_cache_key injection', () => {
  it('injects prompt_cache_key when system prompt exists', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.prompt_cache_key).toMatch(/^cache-/);
  });

  it('omits prompt_cache_key when no system prompt', () => {
    const result: any = formatAnthropicToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.prompt_cache_key).toBeUndefined();
  });

  it('uses same cache key for same system prompt', () => {
    const r1 = formatAnthropicToOpenAI({
      model: 'c1', system: 'You are helpful.', messages: [{ role: 'user', content: 'A' }], max_tokens: 1024,
    });
    const r2 = formatAnthropicToOpenAI({
      model: 'c2', system: 'You are helpful.', messages: [{ role: 'user', content: 'B' }], max_tokens: 1024,
    });
    expect(r1.prompt_cache_key).toBe(r2.prompt_cache_key);
  });

  it('uses different cache keys for different system prompts', () => {
    const r1 = formatAnthropicToOpenAI({
      model: 'c1', system: 'You are helpful.', messages: [{ role: 'user', content: 'A' }], max_tokens: 1024,
    });
    const r2 = formatAnthropicToOpenAI({
      model: 'c2', system: 'You are a code reviewer.', messages: [{ role: 'user', content: 'B' }], max_tokens: 1024,
    });
    expect(r1.prompt_cache_key).not.toBe(r2.prompt_cache_key);
  });
});
