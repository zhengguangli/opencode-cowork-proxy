/**
 * Request body schema validation using Zod.
 *
 * WHEN TO READ THIS FILE: Adding validation for a new request body shape,
 * modifying validation rules, or debugging schema validation errors.
 *
 * Schemas validate request bodies at the handler boundary BEFORE they reach
 * translation logic. This catches malformed requests early with clear error
 * messages, rather than relying on type-guards to silently produce empty values.
 *
 * Each schema corresponds to a handler's expected input shape. Schemas are
 * lenient by default (extra keys are stripped, not rejected) so that adding
 * new API fields doesn't break existing requests.
 *
 * NOTE: Uses Zod v4 which removes .passthrough() — objects are lenient by
 * default (strip unknown keys). Use .strict() to reject unknown keys.
 */
import { z } from 'zod';

// ---- Reusable field schemas ----

const modelSchema = z.string().min(1, 'model is required');
const temperatureSchema = z.number().min(0).max(2).optional();
const topPSchema = z.number().min(0).max(1).optional();
const topKSchema = z.number().int().positive().optional();
const streamSchema = z.boolean().optional();
const maxTokensSchema = z.number().int().positive().optional();
const stopSchema = z.union([z.string(), z.array(z.string())]).optional();
const metadataSchema = z.object({ user_id: z.string().optional() }).optional();
const thinkingSchema = z.object({ type: z.enum(['enabled', 'disabled']).optional() }).optional();
const userIdSchema = z.string().optional();

// ---- Anthropic Messages ----

const anthropicImageSource = z.object({
  type: z.enum(['url', 'base64']),
  url: z.string().optional(),
  media_type: z.string().optional(),
  data: z.string().optional(),
});

const anthropicContentBlock = z.object({
  type: z.string(),
  text: z.string().optional(),
  source: anthropicImageSource.optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  thinking: z.string().optional(),
  signature: z.string().optional(),
});

const anthropicMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(anthropicContentBlock)]),
});

export const anthropicMessagesSchema = z.object({
  model: modelSchema,
  messages: z.array(anthropicMessage).min(1, 'At least one message is required'),
  system: z.union([z.string(), z.array(z.object({ type: z.literal('text').optional(), text: z.string() }))]).optional(),
  max_tokens: maxTokensSchema,
  temperature: temperatureSchema,
  top_p: topPSchema,
  top_k: topKSchema,
  stream: streamSchema,
  stop_sequences: stopSchema,
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.union([z.string(), z.object({ type: z.string(), name: z.string().optional() })]).optional(),
  metadata: metadataSchema,
  thinking: thinkingSchema,
});

// ---- OpenAI Chat Completions ----

const openAIImageUrl = z.object({
  type: z.literal('image_url').optional(),
  image_url: z.object({
    url: z.string(),
    detail: z.string().optional(),
  }),
});

const openAIContentPart = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  openAIImageUrl,
]);

const openAIMessage = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(openAIContentPart)]).nullable().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.unknown()).optional(),
  name: z.string().optional(),
});

export const openAIChatSchema = z.object({
  model: modelSchema,
  messages: z.array(openAIMessage).min(1, 'At least one message is required'),
  max_tokens: maxTokensSchema,
  temperature: temperatureSchema,
  top_p: topPSchema,
  top_k: topKSchema,
  stream: streamSchema,
  stop: stopSchema,
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.union([z.string(), z.object({ type: z.string(), function: z.object({ name: z.string() }).optional() })]).optional(),
  response_format: z.unknown().optional(),
  user: userIdSchema,
  n: z.number().int().positive().optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  logit_bias: z.record(z.string(), z.number()).optional(),
  seed: z.number().int().optional(),
});

// ---- OpenAI Responses API ----

const responsesContentBlock = z.object({
  type: z.string(),
  text: z.string().optional(),
  source: z.object({ type: z.string() }).optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  arguments: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  reasoning_text: z.string().optional(),
  signature: z.string().optional(),
});

const responsesInputItem = z.object({
  type: z.string(),
  role: z.string().optional(),
  content: z.union([z.string(), z.array(responsesContentBlock)]).optional(),
  tool_call_id: z.string().optional(),
  output: z.union([z.string(), z.array(z.unknown())]).optional(),
  reasoning_text: z.string().optional(),
  signature: z.string().optional(),
});

export const responsesAPISchema = z.object({
  model: modelSchema,
  input: z.union([z.string(), z.array(responsesInputItem)]),
  instructions: z.string().optional(),
  max_output_tokens: maxTokensSchema,
  temperature: temperatureSchema,
  top_p: topPSchema,
  top_k: topKSchema,
  stream: streamSchema,
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.union([z.string(), z.object({ type: z.string(), name: z.string().optional() })]).optional(),
  metadata: metadataSchema,
  thinking: thinkingSchema,
  store: z.boolean().optional(),
  previous_response_id: z.string().optional(),
});

// ---- Validation result type ----

export interface ValidationResult<T> {
  ok: true;
  data: T;
}

export interface ValidationError {
  ok: false;
  response: Response;
}

// ---- Validation helpers ----

/**
 * Validate a JSON body against a Zod schema.
 * Returns the parsed data on success, or a 400 Response on failure.
 */
export function validateBody<T>(body: unknown, schema: z.ZodType<T>): ValidationResult<T> | ValidationError {
  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));

  return {
    ok: false,
    response: new Response(JSON.stringify({
      error: {
        type: 'invalid_request_error',
        message: 'Request validation failed',
        details: issues,
      },
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }),
  };
}
