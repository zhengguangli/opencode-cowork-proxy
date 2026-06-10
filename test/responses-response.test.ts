import { describe, it, expect } from 'vitest';
import { formatChatCompletionsToResponses } from '../src/translate/response/chat-completions-to-responses';

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
    const fcItem = result.output.find((o: Record<string, unknown>) => o.type === 'function_call');
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
