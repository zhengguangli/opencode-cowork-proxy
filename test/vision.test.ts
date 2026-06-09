import { describe, it, expect } from 'vitest';
import { getVisionModel, hasImages, hasOpenAIImages, hasResponsesImages, rawBodyMayHaveImages, hasAnyImageInMessages } from '../src/vision';
import { GO_VISION_MODEL, ZEN_VISION_MODEL } from '../src/config';

const GO = 'https://opencode.ai/zen/go';
const ZEN = 'https://opencode.ai/zen';

describe('getVisionModel', () => {
  it('keeps vision-capable GO model on GO upstream', () => {
    expect(getVisionModel(GO, 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('keeps vision-capable ZEN model on ZEN upstream', () => {
    expect(getVisionModel(ZEN, 'mimo-v2.5-free')).toBe('mimo-v2.5-free');
  });

  it('forces GO vision model for non-vision model on GO upstream', () => {
    expect(getVisionModel(GO, 'deepseek-v4-flash')).toBe(GO_VISION_MODEL);
  });

  it('forces ZEN vision model for non-vision model on ZEN upstream', () => {
    expect(getVisionModel(ZEN, 'deepseek-v4-flash')).toBe(ZEN_VISION_MODEL);
  });

  it('returns GO default when no model requested', () => {
    expect(getVisionModel(GO, null)).toBe(GO_VISION_MODEL);
    expect(getVisionModel(GO, undefined)).toBe(GO_VISION_MODEL);
  });

  it('returns GO default for unrecognized upstream', () => {
    expect(getVisionModel('https://unknown.com', 'some-model')).toBe(GO_VISION_MODEL);
  });
});

describe('hasImages', () => {
  it('detects image in messages content', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }] }] };
    expect(hasImages(body)).toBe(true);
  });

  it('returns false when no images in messages', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
    expect(hasImages(body)).toBe(false);
  });

  it('returns false for empty messages', () => {
    expect(hasImages({ messages: [] })).toBe(false);
  });

  it('returns false for undefined body', () => {
    expect(hasImages(undefined)).toBe(false);
  });

  it('returns false for null body', () => {
    expect(hasImages(null)).toBe(false);
  });

  it('detects image in system content', () => {
    const body = { messages: [], system: [{ type: 'image', source: { type: 'base64', data: 'abc' } }] };
    expect(hasImages(body)).toBe(true);
  });
});

describe('hasOpenAIImages', () => {
  it('detects image_url in messages', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } }] }] };
    expect(hasOpenAIImages(body)).toBe(true);
  });

  it('returns false for string content', () => {
    const body = { messages: [{ role: 'user', content: 'text-only' }] };
    expect(hasOpenAIImages(body)).toBe(false);
  });

  it('returns false when no images', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
    expect(hasOpenAIImages(body)).toBe(false);
  });

  it('detects image_url in system', () => {
    const body = { messages: [], system: [{ type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } }] };
    expect(hasOpenAIImages(body)).toBe(true);
  });
});

describe('hasResponsesImages', () => {
  it('detects input_image in input items', () => {
    const body = { input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: { url: 'https://ex.com/img.jpg' } }] }] };
    expect(hasResponsesImages(body)).toBe(true);
  });

  it('detects image_url in input items', () => {
    const body = { input: [{ type: 'message', role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://ex.com/img.jpg' } }] }] };
    expect(hasResponsesImages(body)).toBe(true);
  });

  it('returns false for non-array input', () => {
    expect(hasResponsesImages({ input: 'string' })).toBe(false);
  });

  it('returns false for missing input', () => {
    expect(hasResponsesImages({})).toBe(false);
  });

  it('returns false for input without images', () => {
    const body = { input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
    expect(hasResponsesImages(body)).toBe(false);
  });
});

describe('rawBodyMayHaveImages', () => {
  it('detects "image_url" in raw body', () => {
    expect(rawBodyMayHaveImages('{"messages":[{"image_url":"..."}]}')).toBe(true);
  });

  it('detects "input_image" in raw body', () => {
    expect(rawBodyMayHaveImages('{"input_image":{}}')).toBe(true);
  });

  it('detects "type":"image" in raw body', () => {
    expect(rawBodyMayHaveImages('{"type":"image"}')).toBe(true);
  });

  it('detects "type": "image" with space in raw body', () => {
    expect(rawBodyMayHaveImages('{"type": "image"}')).toBe(true);
  });

  it('returns false for body without image markers', () => {
    expect(rawBodyMayHaveImages('{"messages":[{"role":"user","content":"hi"}]}')).toBe(false);
  });
});

describe('hasAnyImageInMessages', () => {
  it('detects image in messages', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }] }] };
    expect(hasAnyImageInMessages(body)).toBe(true);
  });

  it('detects image_url in messages', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://ex.com/img.jpg' } }] }] };
    expect(hasAnyImageInMessages(body)).toBe(true);
  });

  it('returns false for string content', () => {
    const body = { messages: [{ role: 'user', content: 'just text' }] };
    expect(hasAnyImageInMessages(body)).toBe(false);
  });

  it('returns false for non-array content', () => {
    const body = { messages: [{ role: 'user', content: 'text' }] };
    expect(hasAnyImageInMessages(body)).toBe(false);
  });

  it('returns false when no messages', () => {
    expect(hasAnyImageInMessages({})).toBe(false);
  });

  it('detects image in system', () => {
    const body = { system: [{ type: 'image_url', image_url: { url: 'https://ex.com/img.jpg' } }] };
    expect(hasAnyImageInMessages(body)).toBe(true);
  });
});
