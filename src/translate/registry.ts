/**
 * Registration of all built-in format pairs into the translator registry.
 *
 * WHEN TO READ THIS FILE: Checking which format pairs are registered,
 * adding a new built-in pair, or debugging translation routing.
 *
 * This module adapts the existing pure translation functions to the
 * FormatPair interfaces and registers them with the singleton registry.
 * Handlers can then look up translators by FormatPairKey instead of
 * importing translation functions directly.
 */
import {
  FormatPairKey,
  FormatPair,
  RequestTranslator,
  ResponseTranslator,
  StreamTranslator,
  translatorRegistry,
} from './plugin';

import { formatAnthropicToOpenAI as anthropicToOpenAIRequest } from './request/anthropic-to-openai';
import { formatOpenAIToAnthropic as openaiToAnthropicRequest } from './request/openai-to-anthropic';
import { formatResponsesToChatCompletions as responsesToChatRequest } from './request/responses-to-chat-completions';

import { formatOpenAIToAnthropic as openaiToAnthropicResponse } from './response/openai-to-anthropic';
import { formatAnthropicToOpenAI as anthropicToOpenAIResponse } from './response/anthropic-to-openai';
import { formatChatCompletionsToResponses as chatToResponsesResponse } from './response/chat-completions-to-responses';

import { streamOpenAIToAnthropic as openaiToAnthropicStream } from './stream/openai-to-anthropic';
import { streamAnthropicToOpenAI as anthropicToOpenAIStream } from './stream/anthropic-to-openai';
import { streamChatCompletionsToResponses as chatToResponsesStream } from './stream/chat-completions-to-responses';

// ============================================================
// Anthropic ↔ OpenAI format pair
// ============================================================

const anthropicToOpenAIRequestTranslator: RequestTranslator = {
  name: 'Anthropic Messages → OpenAI Chat Completions',
  sourceFormat: 'anthropic-messages',
  targetFormat: 'openai-chat',
  translate: (body) => anthropicToOpenAIRequest(body),
};

const anthropicToOpenAIResponseTranslator: ResponseTranslator = {
  name: 'OpenAI Chat → Anthropic Messages',
  sourceFormat: 'openai-chat',
  targetFormat: 'anthropic-messages',
  translate: (body, model) => anthropicToOpenAIResponse(body, model),
};

const anthropicToOpenAIStreamTranslator: StreamTranslator = {
  name: 'OpenAI SSE → Anthropic SSE',
  sourceFormat: 'openai-sse',
  targetFormat: 'anthropic-sse',
  translate: (stream, model) => openaiToAnthropicStream(stream, model),
};

const anthropicToOpenAIPair: FormatPair = {
  key: FormatPairKey.AnthropicToOpenAI,
  label: 'Anthropic ↔ OpenAI',
  request: anthropicToOpenAIRequestTranslator,
  response: anthropicToOpenAIResponseTranslator,
  stream: anthropicToOpenAIStreamTranslator,
};

// ============================================================
// OpenAI ↔ Anthropic format pair (reverse direction)
// ============================================================

const openAIToAnthropicRequestTranslator: RequestTranslator = {
  name: 'OpenAI Chat Completions → Anthropic Messages',
  sourceFormat: 'openai-chat',
  targetFormat: 'anthropic-messages',
  translate: (body) => openaiToAnthropicRequest(body),
};

const openAIToAnthropicResponseTranslator: ResponseTranslator = {
  name: 'Anthropic Messages → OpenAI Chat',
  sourceFormat: 'anthropic-messages',
  targetFormat: 'openai-chat',
  translate: (body, model) => openaiToAnthropicResponse(body, model),
};

const openAIToAnthropicStreamTranslator: StreamTranslator = {
  name: 'Anthropic SSE → OpenAI SSE',
  sourceFormat: 'anthropic-sse',
  targetFormat: 'openai-sse',
  translate: (stream, model) => anthropicToOpenAIStream(stream, model),
};

const openAIToAnthropicPair: FormatPair = {
  key: FormatPairKey.OpenAIToAnthropic,
  label: 'OpenAI ↔ Anthropic',
  request: openAIToAnthropicRequestTranslator,
  response: openAIToAnthropicResponseTranslator,
  stream: openAIToAnthropicStreamTranslator,
};

// ============================================================
// Responses API ↔ Chat Completions format pair
// ============================================================

const responsesToChatRequestTranslator: RequestTranslator = {
  name: 'OpenAI Responses → Chat Completions',
  sourceFormat: 'openai-responses',
  targetFormat: 'openai-chat',
  translate: (body) => responsesToChatRequest(body),
};

const chatToResponsesResponseTranslator: ResponseTranslator = {
  name: 'Chat Completions → OpenAI Responses',
  sourceFormat: 'openai-chat',
  targetFormat: 'openai-responses',
  translate: (body, model) => chatToResponsesResponse(body, model),
};

const chatToResponsesStreamTranslator: StreamTranslator = {
  name: 'Chat Completions SSE → Responses SSE',
  sourceFormat: 'openai-chat-sse',
  targetFormat: 'openai-responses-sse',
  translate: (stream, model) => chatToResponsesStream(stream, model),
};

const responsesToChatPair: FormatPair = {
  key: FormatPairKey.ResponsesToChat,
  label: 'Responses API ↔ Chat Completions',
  request: responsesToChatRequestTranslator,
  response: chatToResponsesResponseTranslator,
  stream: chatToResponsesStreamTranslator,
};

// ============================================================
// Register all pairs
// ============================================================

/**
 * Initialize the translator registry with all built-in format pairs.
 * Call once at startup before any handler runs.
 */
export function registerBuiltinTranslators(): void {
  translatorRegistry.register(anthropicToOpenAIPair);
  translatorRegistry.register(openAIToAnthropicPair);
  translatorRegistry.register(responsesToChatPair);
}

/**
 * Lazy-init guard: registers all built-in translators on first call.
 */
let initialized = false;
export function ensureTranslatorsRegistered(): void {
  if (!initialized) {
    registerBuiltinTranslators();
    initialized = true;
  }
}
