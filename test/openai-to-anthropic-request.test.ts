import { describe, it, expect } from 'vitest';
import { formatOpenAIToAnthropic } from '../src/translate/request/openai-to-anthropic';

describe('formatOpenAIToAnthropic (OpenAI → Anthropic request)', () => {
  it('converts a simple message', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.model).toBe('gpt-4');
    expect(result.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]);
    expect(result.max_tokens).toBe(4096);
  });

  it('extracts system messages from messages array', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
    });
    expect(result.system).toBe('You are helpful.');
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('handles multiple system messages', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Rule 1' },
        { role: 'system', content: 'Rule 2' },
        { role: 'user', content: 'Hi' },
      ],
    });
    expect(Array.isArray(result.system)).toBe(true);
    expect(result.system).toEqual(['Rule 1', 'Rule 2']);
  });

  it('converts tool_calls to tool_use blocks', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
          ],
        },
      ],
    });
    const assistant = result.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content[0].type).toBe('tool_use');
    expect(assistant.content[0].name).toBe('get_weather');
    expect(assistant.content[0].input).toEqual({ city: 'Paris' });
  });

  it('does not throw on malformed tool call arguments', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'broken', arguments: '{bad json' } }] },
      ],
    });
    expect(result.messages[0].content[0].input).toEqual({});
  });

  it('extracts image media type from data URL, not detail', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{
        role: 'user',
        content: [{
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,abc123', detail: 'high' },
        }],
      }],
    });
    expect(result.messages[0].content[0].source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: 'abc123',
    });
  });

  it('merges standalone tool messages into user tool_result blocks', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calc', arguments: '{"expr":"2+2"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '4' },
      ],
    });
    // Should have 3 messages: user, assistant (tool_use), user (tool_result)
    expect(result.messages.length).toBe(3);

    // First message: user with text
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content[0]).toEqual({ type: "text", text: "What is 2+2?" });

    // Second message: assistant with tool_use
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].content[0].type).toBe('tool_use');

    // Third message: user with tool_result (from standalone tool message)
    const toolResult = result.messages[2];
    expect(toolResult.role).toBe('user');
    expect(toolResult.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'c1', content: '4' });
  });

  it('passes through optional parameters', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.5,
      top_p: 0.8,
      stop: ['END'],
    });
    expect(result.temperature).toBe(0.5);
    expect(result.top_p).toBe(0.8);
    expect(result.stop_sequences).toEqual(['END']);
  });

  it('handles multi-stop array', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      stop: ['\n', 'END'],
    });
    expect(result.stop_sequences).toEqual(['\n', 'END']);
  });

  it('converts tools format', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [
        { type: 'function', function: { name: 'search', description: 'Search', parameters: { type: 'object' } } },
      ],
    });
    expect(result.tools[0]).toEqual({
      name: 'search', description: 'Search', input_schema: { type: 'object' },
    });
  });

  // Regression: CRITICAL bug 1 from QA report — tool_choice format mismatch (OpenAI→Anthropic).
  // OpenAI: {type:"function", function:{name:"xxx"}} → Anthropic: {type:"tool", name:"xxx"}
  it('maps tool_choice object format {type:"function", function:{name}} to {type:"tool", name}', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Weather?' }],
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
    });
    expect(result.tool_choice).toEqual({ type: 'tool', name: 'get_weather' });
  });

  // Regression: tool_choice string "required" → Anthropic "any"
  it('maps tool_choice string "required" to Anthropic "any"', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: 'required',
    });
    expect(result.tool_choice).toBe('any');
  });

  it('passes through tool_choice string "auto" and "none" unchanged', () => {
    const r1 = formatOpenAIToAnthropic({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }], tool_choice: 'auto' });
    const r2 = formatOpenAIToAnthropic({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }], tool_choice: 'none' });
    expect(r1.tool_choice).toBe('auto');
    expect(r2.tool_choice).toBe('none');
  });

  // Regression: F2 review fix — defensive guard for missing function.name
  it('falls back to {type:"tool"} when tool_choice.function.name is missing', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'function', function: {} },
    });
    expect(result.tool_choice.type).toBe('tool');
    expect(result.tool_choice.name).toBeUndefined();
  });

  // Regression: passthrough additional fields
  it('passes through response_format and user (metadata.user_id)', () => {
    const result: any = formatOpenAIToAnthropic({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      response_format: { type: 'json_object' },
      user: 'user-123',
    });
    expect(result.response_format).toEqual({ type: 'json_object' });
    expect(result.metadata).toEqual({ user_id: 'user-123' });
  });
});
