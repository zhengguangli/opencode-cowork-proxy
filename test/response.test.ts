import { describe, it, expect } from 'vitest';
import { formatOpenAIToAnthropic } from '../src/translate/response/openai-to-anthropic';
import { formatAnthropicToOpenAI } from '../src/translate/response/anthropic-to-openai';

describe('formatOpenAIToAnthropic (OpenAI → Anthropic response)', () => {
  it('converts a text response', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }, 'claude-sonnet-4-20250514');
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.content).toEqual([{ text: 'Hello!', type: 'text' }]);
    expect(result.stop_reason).toBe('end_turn');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.usage).toEqual({
      input_tokens: 10, output_tokens: 5,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    });
  });

  it('converts reasoning_content to an Anthropic thinking block', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', reasoning_content: 'internal reasoning', content: 'final answer' }, finish_reason: 'stop' }],
    }, 'deepseek-reasoner');
    expect(result.content).toEqual([
      { type: 'thinking', thinking: 'internal reasoning', signature: '' },
      { text: 'final answer', type: 'text' },
    ]);
  });

  it('converts a tool call response', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'call_001',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }, 'claude-sonnet-4-20250514');
    expect(result.content[0].type).toBe('tool_use');
    expect(result.content[0].name).toBe('get_weather');
    expect(result.content[0].input).toEqual({ city: 'Paris' });
    expect(result.stop_reason).toBe('tool_use');
  });

  it('does not throw on malformed tool call arguments', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'call_001',
            type: 'function',
            function: { name: 'broken', arguments: '{bad json' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }, 'claude-sonnet-4-20250514');
    expect(result.content[0].input).toEqual({});
  });

  it('maps finish_reason "length" to "max_tokens"', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: 'truncated...' }, finish_reason: 'length' }],
    }, 'claude-sonnet-4-20250514');
    expect(result.stop_reason).toBe('max_tokens');
  });

  // Regression: LOW bug 8 from QA report — content_filter and insufficient_system_resource
  // used to fall through silently to end_turn; they now map to max_tokens (truncation signal).
  it('maps finish_reason "content_filter" to "max_tokens"', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: '[filtered]' }, finish_reason: 'content_filter' }],
    }, 'claude-sonnet-4-20250514');
    expect(result.stop_reason).toBe('max_tokens');
  });

  it('maps finish_reason "insufficient_system_resource" to "max_tokens"', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'insufficient_system_resource' }],
    }, 'claude-sonnet-4-20250514');
    expect(result.stop_reason).toBe('max_tokens');
  });

  it('maps finish_reason "stop" to "end_turn"', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
    }, 'claude-sonnet-4-20250514');
    expect(result.stop_reason).toBe('end_turn');
  });

  it('handles missing usage gracefully', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
    }, 'claude-sonnet-4-20250514');
    expect(result.usage).toBeUndefined();
  });

  it('includes cache_read_input_tokens from cached_tokens', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    }, 'claude-sonnet-4-20250514');
    expect(result.usage.cache_read_input_tokens).toBe(400);
    expect(result.usage.cache_creation_input_tokens).toBe(0);
    expect(result.usage.input_tokens).toBe(600);
    expect(result.usage.output_tokens).toBe(50);
  });

  it('maps OpenAI-compatible input_tokens/output_tokens usage to Anthropic usage', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 400 },
    }, 'deepseek-v4-pro');
    expect(result.usage).toEqual({
      input_tokens: 600,
      output_tokens: 50,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 0,
    });
  });

  it('sets cache_read_input_tokens to 0 when no cached_tokens', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 200, completion_tokens: 30 },
    }, 'claude-sonnet-4-20250514');
    expect(result.usage.cache_read_input_tokens).toBe(0);
  });

  it('handles content that is not string (e.g. null for tool calls)', () => {
    const result: any = formatOpenAIToAnthropic({
      choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
    }, 'claude-sonnet-4-20250514');
    expect(result.content).toEqual([]);
  });
});

describe('formatAnthropicToOpenAI (Anthropic → OpenAI response)', () => {
  it('converts a text response', () => {
    const result: any = formatAnthropicToOpenAI({
      content: [{ type: 'text', text: 'Hello from Claude!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }, 'claude-sonnet-4-20250514');
    expect(result.object).toBe('chat.completion');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.choices[0].message.content).toBe('Hello from Claude!');
    expect(result.choices[0].finish_reason).toBe('stop');
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it('maps prompt_tokens/completion_tokens usage when Anthropic upstream returns OpenAI-compatible usage', () => {
    const result: any = formatAnthropicToOpenAI({
      content: [{ type: 'text', text: 'Hello from Claude!' }],
      stop_reason: 'end_turn',
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    }, 'claude-sonnet-4-20250514');
    expect(result.usage).toEqual({ prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 });
  });

  it('converts a tool_use response', () => {
    const result: any = formatAnthropicToOpenAI({
      content: [{ type: 'tool_use', id: 'tool_001', name: 'search', input: { query: 'cats' } }],
      stop_reason: 'tool_use',
    }, 'claude-sonnet-4-20250514');
    expect(result.choices[0].message.tool_calls).toEqual([{
      id: 'tool_001',
      type: 'function',
      function: { name: 'search', arguments: '{"query":"cats"}' },
    }]);
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });

  it('maps stop_reason "max_tokens" to finish_reason "length"', () => {
    const result: any = formatAnthropicToOpenAI({
      content: [{ type: 'text', text: 'truncated' }],
      stop_reason: 'max_tokens',
    }, 'claude-sonnet-4-20250514');
    expect(result.choices[0].finish_reason).toBe('length');
  });

  it('handles missing usage', () => {
    const result: any = formatAnthropicToOpenAI({
      content: [{ type: 'text', text: 'Hi' }],
      stop_reason: 'end_turn',
    }, 'claude-sonnet-4-20250514');
    expect(result.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  // Regression: MEDIUM bug 6 from QA report — Anthropic upstream cache tokens lost in
  // response translation. cache_read_input_tokens must be preserved in OpenAI format
  // as prompt_tokens_details.cached_tokens, and prompt_tokens must include cached tokens
  // (OpenAI convention) so consumers do not under-count.
  it('preserves Anthropic cache_read_input_tokens as OpenAI prompt_tokens_details.cached_tokens', () => {
    const result: any = formatAnthropicToOpenAI({
      content: [{ type: 'text', text: 'Hello from cache!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 400 },
    }, 'claude-sonnet-4-20250514');
    expect(result.usage.prompt_tokens).toBe(500);  // 100 fresh + 400 cached
    expect(result.usage.completion_tokens).toBe(5);
    expect(result.usage.total_tokens).toBe(505);
    expect(result.usage.prompt_tokens_details).toEqual({ cached_tokens: 400 });
  });
});
