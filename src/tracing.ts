/**
 * OpenTelemetry tracing — span creation, OTLP export, child span utilities.
 *
 * Spans are created for every request (root) and key phases. When
 * OTEL_EXPORTER_OTLP_ENDPOINT is set, spans are exported via OTLP;
 * otherwise they go to console for development debugging.
 *
 * ENV CONFIGURATION:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTLP HTTP endpoint (e.g. http://jaeger:4318/v1/traces)
 *   OTEL_SERVICE_NAME           — Service name in traces (default: opencode-cowork-proxy)
 *
 * WHEN TO READ THIS FILE: Adding new trace spans, configuring OTLP export.
 */
import { trace, context, Span, SpanStatusCode, Tracer } from '@opentelemetry/api';
import { BasicTracerProvider, BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const SERVICE_NAME = process?.env?.OTEL_SERVICE_NAME ?? 'opencode-cowork-proxy';
const SERVICE_VERSION = '2.1.5';
const otelEndpoint = process?.env?.OTEL_EXPORTER_OTLP_ENDPOINT;

const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    'service.version': SERVICE_VERSION,
  }),
  spanProcessors: otelEndpoint
    ? [new BatchSpanProcessor(new (require('@opentelemetry/exporter-trace-otlp-proto').OTLPTraceExporter)({ url: otelEndpoint }))]
    : [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});

// Register as global tracer provider so trace.getTracer() returns our tracer
trace.setGlobalTracerProvider(provider);

const TRACER: Tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

// ---- Module-level span tracking for utility functions ----

/** @internal Current root span for this request (read by safeUpstreamFetch, etc.). */
export let currentSpan: Span | undefined;

/** @internal Set the current span (used by index.ts before handler dispatch). */
export function setCurrentSpan(span: Span | undefined): void {
  currentSpan = span;
}

/**
 * Start a root span for an incoming request. Also sets it as the current span
 * so utility functions can create child spans.
 */
export function startRequestSpan(path: string, method: string): Span {
  const span = TRACER.startSpan(`request ${method} ${path}`, {
    attributes: { 'http.method': method, 'http.path': path },
  });
  setCurrentSpan(span);
  return span;
}

/**
 * Start a child span under the given parent or the module-level current span.
 */
export function startSpan(name: string, parent?: Span): Span {
  const p = parent ?? currentSpan;
  let ctx = context.active();
  if (p) ctx = trace.setSpan(ctx, p);
  return TRACER.startSpan(name, undefined, ctx);
}

/**
 * Complete a span with optional attributes.
 * If attrs contains an 'error' key with a truthy value, the span is ERROR.
 */
export function endSpan(span: Span, attrs?: Record<string, string | number | boolean | undefined>): void {
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined) {
        if (k === 'error' && v) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(v) });
        }
        span.setAttribute(k, v);
      }
    }
  }
  span.end();
  if (currentSpan === span) setCurrentSpan(undefined);
}

/**
 * Record an exception on a span and mark it as error.
 */
export function recordError(span: Span, error: Error): void {
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}
