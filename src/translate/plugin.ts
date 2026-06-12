/**
 * Plugin architecture interfaces for the translation layer.
 *
 * WHEN TO READ THIS FILE: Adding a new format pair, understanding the plugin
 * contract, or registering a custom translator.
 *
 * Architecture:
 *
 *   FormatPair (request + response + stream translators)
 *        ↕
 *   TranslatorRegistry (keyed by format pair name)
 *        ↕
 *   Handler picks the right FormatPair via FormatKey + UpstreamFormat
 *
 * This decouples translation logic from routing. To add a new format pair
 * (e.g., Google AI ↔ Anthropic), implement FormatPair and register it.
 */

// ---- Format keys ----

/**
 * Identifies a translation format pair.
 *
 * Examples:
 *   FormatPairKey.AnthropicToOpenAI   — translates Anthropic ↔ OpenAI
 *   FormatPairKey.ResponsesToChat     — translates Responses API ↔ Chat Completions
 */
export enum FormatPairKey {
  AnthropicToOpenAI = 'anthropic-to-openai',
  OpenAIToAnthropic = 'openai-to-anthropic',
  ResponsesToChat = 'responses-to-chat',
}

// ---- Translator interfaces ----

/**
 * Request translator: converts an incoming request body from one format to another.
 *
 * @typeParam TBody — The shape of the input request body (default Record)
 */
export interface RequestTranslator<TBody = Record<string, unknown>> {
  /** Translate request body from source format to target format */
  translate(body: TBody, model?: string): Record<string, unknown>;
  /** Human-readable name for the translation direction */
  name: string;
  /** Source API format label (e.g., "anthropic-messages") */
  sourceFormat: string;
  /** Target API format label (e.g., "openai-chat") */
  targetFormat: string;
}

/**
 * Response translator: converts an upstream response body from one format to another.
 */
export interface ResponseTranslator {
  /** Translate response body from upstream format to client format */
  translate(body: Record<string, unknown>, model: string): Record<string, unknown>;
  name: string;
  sourceFormat: string;
  targetFormat: string;
}

/**
 * Stream translator: converts SSE byte streams from one format to another.
 */
export interface StreamTranslator {
  /** Translate a ReadableStream from upstream format to client format */
  translate(stream: ReadableStream, model: string): ReadableStream;
  name: string;
  sourceFormat: string;
  targetFormat: string;
}

// ---- Format pair ----

/**
 * A complete translation pair: request + response + stream translators
 * for a specific format direction.
 *
 * Example: AnthropicToOpenAI pair translates:
 *   - Requests: Anthropic Messages → OpenAI Chat Completions
 *   - Responses: OpenAI Chat → Anthropic Messages
 *   - Streams: OpenAI SSE → Anthropic SSE
 */
export interface FormatPair {
  /** Unique identifier */
  key: FormatPairKey;
  /** Label for debugging/logging */
  label: string;
  /** Request translator */
  request: RequestTranslator;
  /** Response translator (non-streaming) */
  response: ResponseTranslator;
  /** Stream translator (SSE) */
  stream: StreamTranslator;
}

// ---- Type alias for handler mapping ----

/**
 * Which translation operations a specific handler needs.
 */
export interface HandlerTranslators {
  /** Request translator (source → target) */
  request: RequestTranslator;
  /** Response translator (target → source) */
  response: ResponseTranslator;
  /** Stream translator (target → source) */
  stream: StreamTranslator;
}

// ---- Registry ----

/**
 * Central registry for translation format pairs.
 * Allows dynamic registration of new format pairs without modifying core routing.
 */
export class TranslatorRegistry {
  private pairs = new Map<FormatPairKey, FormatPair>();

  /** Register a format pair. Overwrites any existing pair with the same key. */
  register(pair: FormatPair): void {
    this.pairs.set(pair.key, pair);
  }

  /** Get a registered format pair by key. Returns undefined if not found. */
  get(key: FormatPairKey): FormatPair | undefined {
    return this.pairs.get(key);
  }

  /** Get all registered format pair keys. */
  keys(): FormatPairKey[] {
    return Array.from(this.pairs.keys());
  }

  /** Check if a format pair is registered. */
  has(key: FormatPairKey): boolean {
    return this.pairs.has(key);
  }

  /** Get a HandlerTranslators bundle for a given pair key. */
  getHandlerTranslators(key: FormatPairKey): HandlerTranslators | undefined {
    const pair = this.pairs.get(key);
    if (!pair) return undefined;
    return {
      request: pair.request,
      response: pair.response,
      stream: pair.stream,
    };
  }

  /** Unregister a format pair. */
  unregister(key: FormatPairKey): boolean {
    return this.pairs.delete(key);
  }

  /** Remove all registered pairs. */
  clear(): void {
    this.pairs.clear();
  }
}

// ---- Singleton instance ----

/** Global translator registry instance. */
export const translatorRegistry = new TranslatorRegistry();
