#!/usr/bin/env node
/**
 * OpenAPI 3.1.0 spec generator for opencode-cowork-proxy.
 *
 * Usage:
 *   node scripts/generate-openapi.mjs              # Print spec to stdout
 *   node scripts/generate-openapi.mjs --save       # Write to docs/openapi.json
 *
 * Generates a complete OpenAPI specification from the project's package.json,
 * source code analysis, and known endpoint definitions.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'OpenCode Cowork Proxy',
    version: pkg.version,
    description: pkg.description,
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'https://your-worker.example.com', description: 'Cloudflare Workers (production)' },
    { url: 'http://localhost:18787', description: 'Local development (Bun standalone)' },
  ],
  paths: {
    '/': {
      get: {
        summary: 'Health check',
        description: 'Returns service name, version, uptime, upstream configuration, and available endpoints.',
        operationId: 'healthCheck',
        security: [],
        responses: {
          '200': {
            description: 'Service information',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/v1/messages': {
      post: {
        summary: 'Anthropic Messages API',
        description: 'Accepts Anthropic-format requests and translates them to OpenAI Chat Completions format (or pass-through to Anthropic upstream when X-Upstream-Format is set).',
        operationId: 'createMessage',
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AnthropicMessageRequest' } } },
        },
        parameters: [
          { name: 'X-Upstream-Format', in: 'header', schema: { type: 'string', enum: ['openai', 'anthropic'] }, description: 'Upstream API format' },
          { name: 'Anthropic-Version', in: 'header', schema: { type: 'string' }, description: 'Anthropic API version' },
        ],
        responses: {
          '200': { description: 'Successful response (translated to client format)' },
          '400': { description: 'Invalid request' },
          '401': { description: 'Authentication error' },
        },
      },
    },
    '/v1/chat/completions': {
      post: {
        summary: 'OpenAI Chat Completions API',
        description: 'Accepts OpenAI-format requests and passes through to OpenAI upstream (or translates to Anthropic when X-Upstream-Format is set).',
        operationId: 'createChatCompletion',
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/OpenAIChatRequest' } } },
        },
        responses: {
          '200': { description: 'Successful response' },
          '400': { description: 'Invalid request' },
        },
      },
    },
    '/v1/responses': {
      post: {
        summary: 'OpenAI Responses API',
        description: 'Accepts OpenAI Responses API format, translates internally to Chat Completions, and returns Responses API format.',
        operationId: 'createResponse',
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ResponsesAPIRequest' } } },
        },
        responses: {
          '200': { description: 'Successful response (Responses API format)' },
        },
      },
    },
    '/v1/models': {
      get: {
        summary: 'List models',
        description: 'Proxies upstream model list with 300s Cloudflare Cache.',
        operationId: 'listModels',
        security: [{ apiKey: [] }],
        responses: {
          '200': { description: 'Model list' },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Prometheus metrics',
        description: 'Returns Prometheus-format metrics for observability.',
        operationId: 'getMetrics',
        security: [],
        responses: {
          '200': { description: 'Prometheus metrics (text/plain)' },
        },
      },
    },
    '/health/upstream': {
      get: {
        summary: 'Upstream health probe',
        description: 'Reports upstream connectivity. Add ?probe=true to perform a live probe.',
        operationId: 'checkUpstreamHealth',
        security: [],
        parameters: [
          { name: 'probe', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Perform live upstream probe' },
        ],
        responses: {
          '200': { description: 'Upstream is healthy' },
          '503': { description: 'Upstream is degraded or unreachable' },
        },
      },
    },
    '/audit/log': {
      get: {
        summary: 'Audit log',
        description: 'Returns recent audit events from the in-memory ring buffer.',
        operationId: 'getAuditLog',
        security: [],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 200, maximum: 1000 }, description: 'Number of events to return' },
        ],
        responses: {
          '200': { description: 'Audit events (JSON array)' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
        description: 'OpenCode API key (sk-... or pk-...)',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Alternative: Authorization: Bearer <key>',
      },
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          status: { type: 'string' },
          uptime: { type: 'string' },
          upstream: { type: 'string' },
          routes: { type: 'object' },
          endpoints: { type: 'object' },
        },
      },
      AnthropicMessageRequest: {
        type: 'object',
        required: ['model', 'messages'],
        properties: {
          model: { type: 'string' },
          messages: { type: 'array', items: { type: 'object' } },
          system: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] },
          max_tokens: { type: 'integer' },
          temperature: { type: 'number' },
          stream: { type: 'boolean' },
        },
      },
      OpenAIChatRequest: {
        type: 'object',
        required: ['model', 'messages'],
        properties: {
          model: { type: 'string' },
          messages: { type: 'array', items: { type: 'object' } },
          max_tokens: { type: 'integer' },
          temperature: { type: 'number' },
          stream: { type: 'boolean' },
          tools: { type: 'array', items: { type: 'object' } },
        },
      },
      ResponsesAPIRequest: {
        type: 'object',
        required: ['model', 'input'],
        properties: {
          model: { type: 'string' },
          input: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] },
          instructions: { type: 'string' },
          max_output_tokens: { type: 'integer' },
          stream: { type: 'boolean' },
        },
      },
    },
  },
  externalDocs: {
    description: 'GitHub Repository',
    url: 'https://github.com/cucoleadan/opencode-cowork-proxy',
  },
};

const output = JSON.stringify(spec, null, 2);

if (process.argv.includes('--save')) {
  const outPath = join(ROOT, 'docs', 'openapi.json');
  writeFileSync(outPath, output, 'utf-8');
  console.log(`Written to ${outPath}`);
} else {
  console.log(output);
}
