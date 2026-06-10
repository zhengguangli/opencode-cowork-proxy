/**
 * Barrel export for all 9 translation modules.
 *
 * WHEN TO READ THIS FILE: Adding a new translation function, renaming exports,
 * or checking which format conversions are available.
 *
 * Request translators:
 *   formatAnthropicToOpenAI       — Anthropic Messages → OpenAI Chat Completions
 *   formatOpenAIToAnthropic       — OpenAI Chat Completions → Anthropic Messages
 *   formatResponsesToChatCompletions — OpenAI Responses → Chat Completions
 *
 * Response translators (non-streaming):
 *   toOpenAIResponse              — Anthropic Messages → OpenAI Chat (responses)
 *   toAnthropicResponse           — OpenAI Chat → Anthropic Messages (responses)
 *   formatChatCompletionsToResponses — Chat Completions → OpenAI Responses
 *
 * Stream translators:
 *   streamAnthropicToOpenAI       — Anthropic SSE → OpenAI SSE
 *   streamOpenAIToAnthropic       — OpenAI SSE → Anthropic SSE
 *   streamChatCompletionsToResponses — Chat Completions SSE → Responses SSE
 */

export { formatAnthropicToOpenAI } from './request/anthropic-to-openai';
export { formatOpenAIToAnthropic } from './request/openai-to-anthropic';
export { formatResponsesToChatCompletions } from './request/responses-to-chat-completions';

export { formatOpenAIToAnthropic as toAnthropicResponse } from './response/openai-to-anthropic';
export { formatAnthropicToOpenAI as toOpenAIResponse } from './response/anthropic-to-openai';
export { formatChatCompletionsToResponses } from './response/chat-completions-to-responses';

export { streamAnthropicToOpenAI } from './stream/anthropic-to-openai';
export { streamOpenAIToAnthropic } from './stream/openai-to-anthropic';
export { streamChatCompletionsToResponses } from './stream/chat-completions-to-responses';
