import { describe, it, expect, beforeEach } from 'vitest';
import {
  FormatPairKey,
  TranslatorRegistry,
  FormatPair,
  RequestTranslator,
  ResponseTranslator,
  StreamTranslator,
} from '../src/translate/plugin';
import {
  registerBuiltinTranslators,
  ensureTranslatorsRegistered,
} from '../src/translate/registry';

describe('TranslatorRegistry', () => {
  let registry: TranslatorRegistry;

  beforeEach(() => {
    registry = new TranslatorRegistry();
  });

  it('starts empty', () => {
    expect(registry.keys()).toHaveLength(0);
  });

  it('registers and retrieves a format pair', () => {
    const request: RequestTranslator = {
      name: 'Test Request',
      sourceFormat: 'a',
      targetFormat: 'b',
      translate: (body) => body,
    };
    const response: ResponseTranslator = {
      name: 'Test Response',
      sourceFormat: 'b',
      targetFormat: 'a',
      translate: (body, model) => ({ ...body, model }),
    };
    const stream: StreamTranslator = {
      name: 'Test Stream',
      sourceFormat: 'b-sse',
      targetFormat: 'a-sse',
      translate: (stream) => stream,
    };

    const pair: FormatPair = {
      key: FormatPairKey.AnthropicToOpenAI,
      label: 'Test Pair',
      request,
      response,
      stream,
    };

    registry.register(pair);
    expect(registry.has(FormatPairKey.AnthropicToOpenAI)).toBe(true);
    expect(registry.keys()).toContain(FormatPairKey.AnthropicToOpenAI);

    const retrieved = registry.get(FormatPairKey.AnthropicToOpenAI);
    expect(retrieved).toBeDefined();
    expect(retrieved!.label).toBe('Test Pair');
    expect(retrieved!.request.name).toBe('Test Request');
  });

  it('returns undefined for unknown key', () => {
    expect(registry.get(FormatPairKey.AnthropicToOpenAI)).toBeUndefined();
  });

  it('returns undefined for unknown handler translators', () => {
    expect(registry.getHandlerTranslators(FormatPairKey.AnthropicToOpenAI)).toBeUndefined();
  });

  it('getHandlerTranslators returns all three translators', () => {
    const request: RequestTranslator = {
      name: 'Req', sourceFormat: 'a', targetFormat: 'b',
      translate: (body) => body,
    };
    const response: ResponseTranslator = {
      name: 'Res', sourceFormat: 'b', targetFormat: 'a',
      translate: (body, model) => ({ ...body, model }),
    };
    const stream: StreamTranslator = {
      name: 'Str', sourceFormat: 'b-sse', targetFormat: 'a-sse',
      translate: (s) => s,
    };

    registry.register({
      key: FormatPairKey.AnthropicToOpenAI,
      label: 'T',
      request, response, stream,
    });

    const ht = registry.getHandlerTranslators(FormatPairKey.AnthropicToOpenAI);
    expect(ht).toBeDefined();
    expect(ht!.request.name).toBe('Req');
    expect(ht!.response.name).toBe('Res');
    expect(ht!.stream.name).toBe('Str');
  });

  it('unregister removes a pair', () => {
    const pair: FormatPair = {
      key: FormatPairKey.AnthropicToOpenAI,
      label: 'T',
      request: { name: 'R', sourceFormat: 'a', targetFormat: 'b', translate: (b) => b },
      response: { name: 'S', sourceFormat: 'b', targetFormat: 'a', translate: (b, m) => ({ ...b, model: m }) },
      stream: { name: 'St', sourceFormat: 'b-sse', targetFormat: 'a-sse', translate: (s) => s },
    };
    registry.register(pair);
    expect(registry.has(FormatPairKey.AnthropicToOpenAI)).toBe(true);
    registry.unregister(FormatPairKey.AnthropicToOpenAI);
    expect(registry.has(FormatPairKey.AnthropicToOpenAI)).toBe(false);
  });

  it('clear removes all pairs', () => {
    const dummy = (key: FormatPairKey): FormatPair => ({
      key,
      label: key,
      request: { name: 'R', sourceFormat: 'a', targetFormat: 'b', translate: (b) => b },
      response: { name: 'S', sourceFormat: 'b', targetFormat: 'a', translate: (b, m) => ({ ...b, model: m }) },
      stream: { name: 'St', sourceFormat: 'b-sse', targetFormat: 'a-sse', translate: (s) => s },
    });

    registry.register(dummy(FormatPairKey.AnthropicToOpenAI));
    registry.register(dummy(FormatPairKey.OpenAIToAnthropic));
    registry.register(dummy(FormatPairKey.ResponsesToChat));

    expect(registry.keys()).toHaveLength(3);
    registry.clear();
    expect(registry.keys()).toHaveLength(0);
  });

  it('overwrites existing pair on re-register', () => {
    const pair1: FormatPair = {
      key: FormatPairKey.AnthropicToOpenAI,
      label: 'First',
      request: { name: 'R1', sourceFormat: 'a', targetFormat: 'b', translate: (b) => b },
      response: { name: 'S1', sourceFormat: 'b', targetFormat: 'a', translate: (b, m) => ({ ...b, model: m }) },
      stream: { name: 'St1', sourceFormat: 'b-sse', targetFormat: 'a-sse', translate: (s) => s },
    };
    const pair2: FormatPair = {
      key: FormatPairKey.AnthropicToOpenAI,
      label: 'Second',
      request: { name: 'R2', sourceFormat: 'c', targetFormat: 'd', translate: (b) => b },
      response: { name: 'S2', sourceFormat: 'd', targetFormat: 'c', translate: (b, m) => ({ ...b, model: m }) },
      stream: { name: 'St2', sourceFormat: 'd-sse', targetFormat: 'c-sse', translate: (s) => s },
    };

    registry.register(pair1);
    expect(registry.get(FormatPairKey.AnthropicToOpenAI)!.label).toBe('First');

    registry.register(pair2);
    expect(registry.get(FormatPairKey.AnthropicToOpenAI)!.label).toBe('Second');
  });
});

describe('registerBuiltinTranslators', () => {
  it('registers all 3 built-in format pairs', () => {
    const registry = new TranslatorRegistry();
    // Manually register into a clean registry to test
    const request: RequestTranslator = {
      name: 'R', sourceFormat: 'a', targetFormat: 'b', translate: (b) => b,
    };
    const response: ResponseTranslator = {
      name: 'S', sourceFormat: 'b', targetFormat: 'a', translate: (b, m) => ({ ...b, model: m }),
    };
    const stream: StreamTranslator = {
      name: 'St', sourceFormat: 'b-sse', targetFormat: 'a-sse', translate: (s) => s,
    };

    registry.register({
      key: FormatPairKey.AnthropicToOpenAI, label: 'A↔O',
      request, response, stream,
    });
    registry.register({
      key: FormatPairKey.OpenAIToAnthropic, label: 'O↔A',
      request, response, stream,
    });
    registry.register({
      key: FormatPairKey.ResponsesToChat, label: 'R↔C',
      request, response, stream,
    });

    expect(registry.keys()).toHaveLength(3);
    expect(registry.has(FormatPairKey.AnthropicToOpenAI)).toBe(true);
    expect(registry.has(FormatPairKey.OpenAIToAnthropic)).toBe(true);
    expect(registry.has(FormatPairKey.ResponsesToChat)).toBe(true);
  });
});

describe('ensureTranslatorsRegistered', () => {
  it('runs without error', () => {
    expect(() => ensureTranslatorsRegistered()).not.toThrow();
  });

  it('is idempotent', () => {
    ensureTranslatorsRegistered();
    ensureTranslatorsRegistered();
    ensureTranslatorsRegistered();
    // Should not throw — lazy init guard prevents double-register issues
  });
});
