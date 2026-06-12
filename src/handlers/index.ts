/**
 * Barrel export for all 9 route-specific handlers and the shared RouteInfo interface.
 *
 * WHEN TO READ THIS FILE: Adding a new handler module, or checking which
 * handlers are available for import by src/index.ts.
 *
 * HANDLER MAP:
 *   handleAnthropicToOpenAI      — POST /v1/messages (Anthropic client)
 *   handleOpenAIChatCompletions   — POST /v1/chat/completions (OpenAI client)
 *   handleResponsesAPI           — POST /v1/responses (Responses API client)
 *   handleModelList              — GET /v1/models (model discovery)
 *   handleHealthCheck            — GET / (health check, no auth)
 *   handleMetrics                — GET /metrics (Prometheus metrics, no auth)
 *   handleUpstreamHealth         — GET /health/upstream?probe=true (upstream probe)
 *   handleAuditLog               — GET /audit/log (audit event retrieval)
 *   handleWebSocketUpgrade       — WS /ws/v1/messages (WebSocket streaming)
 */

export { type RouteInfo } from './shared';
export { handleAnthropicToOpenAI } from './messages';
export { handleOpenAIChatCompletions } from './chat-completions';
export { handleResponsesAPI } from './responses';
export { handleModelList } from './models';
export { handleHealthCheck } from './health';
export { handleMetrics } from './metrics';
export { handleUpstreamHealth } from './health-upstream';
export { handleAuditLog } from './audit-log';
export { handleWebSocketUpgrade } from './websocket';
