import { describe, it, expect } from 'vitest';
import { anthropicMessagesSchema, openAIChatSchema, responsesAPISchema, validateBody } from '../src/validate';

describe('anthropicMessagesSchema', () => {
  it('accepts valid Anthropic messages body', () => {
    const result = anthropicMessagesSchema.safeParse({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
    });
    expect(result.success).toBe(true);
  });

  it('accepts messages with content arrays', () => {
    const result = anthropicMessagesSchema.safeParse({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }, { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } }],
      }],
      max_tokens: 1024,
    });
    expect(result.success).toBe(true);
  });

  it('accepts messages with system prompt', () => {
    const result = anthropicMessagesSchema.safeParse({
      model: 'claude-sonnet-4-20250514',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty messages array', () => {
    const result = anthropicMessagesSchema.safeParse({
      model: 'claude-sonnet-4-20250514',
      messages: [],
      max_tokens: 1024,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing model', () => {
    const result = anthropicMessagesSchema.safeParse({
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
    });
    expect(result.success).toBe(false);
  });

  it('allows extra unknown keys (lenient)', () => {
    const result = anthropicMessagesSchema.safeParse({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1024,
      unknown_field: 'should be allowed',
    });
    expect(result.success).toBe(true);
  });
});

describe('openAIChatSchema', () => {
  it('accepts valid OpenAI chat body', () => {
    const result = openAIChatSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts messages with tool calls', () => {
    const result = openAIChatSchema.safeParse({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Weather?' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'Sunny' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts image_url content', () => {
    const result = openAIChatSchema.safeParse({
      model: 'gpt-4',
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],
      }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty messages', () => {
    const result = openAIChatSchema.safeParse({
      model: 'gpt-4',
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  it('allows extra keys (lenient)', () => {
    const result = openAIChatSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      extra_param: 42,
    });
    expect(result.success).toBe(true);
  });
});

describe('responsesAPISchema', () => {
  it('accepts valid Responses API body with string input', () => {
    const result = responsesAPISchema.safeParse({
      model: 'gpt-5',
      input: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  it('accepts Responses API body with array input', () => {
    const result = responsesAPISchema.safeParse({
      model: 'gpt-5',
      input: [{ type: 'message', role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing model', () => {
    const result = responsesAPISchema.safeParse({
      input: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('allows extra keys (lenient)', () => {
    const result = responsesAPISchema.safeParse({
      model: 'gpt-5',
      input: 'Hi',
      custom_field: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('validateBody helper', () => {
  it('returns parsed data on success', () => {
    const result = validateBody({ model: 'test', messages: [{ role: 'user', content: 'Hi' }] }, openAIChatSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.model).toBe('test');
    }
  });

  it('returns 400 response on validation failure', () => {
    const result = validateBody({ messages: [] }, openAIChatSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it('includes validation details in error response', async () => {
    const result = validateBody({ messages: [] }, openAIChatSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;
      expect(error.type).toBe('invalid_request_error');
      expect(error.details).toBeDefined();
    }
  });
});
