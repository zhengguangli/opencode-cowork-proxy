/**
 * OpenTelemetry-based tracing for request pipeline.
 *
 * Creates root spans per request and child spans for key phases
 * (auth, translate, upstream fetch). Spans are emitted via Pino
 * for immediate visibility. Future: add OTLP exporter for
 * integration with Jaeger, Grafana Tempo, Datadog, etc.
 *
 * WHEN TO READ THIS FILE: Adding new trace spans, modifying span
 * attributes, or setting up OTLP export.
 */
import { trace, context, Span, SpanStatusCode } from '@opentelemetry/api';

const TRACER = trace.getTracer('opencode-cowork-proxy', '2.1.5');

/**
 * Start a root span for an incoming request.
 * Returns the span for later endSpan().
 */
export function startRequestSpan(path: string, method: string): Span {
  return TRACER.startSpan(`request ${method} ${path}`, {
    attributes: { 'http.method': method, 'http.path': path },
  });
}

/**
 * Start a child span under the given parent or using the current OTel context.
 */
export function startSpan(name: string, parent?: Span): Span {
  let ctx = context.active();
  if (parent) {
    ctx = trace.setSpan(ctx, parent);
  }
  return TRACER.startSpan(name, undefined, ctx);
}

/**
 * Complete a span with optional attributes.
 * If attrs contains 'error' key with a truthy value, span is marked as error.
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
}

/**
 * Record an exception on a span and mark it as error.
 */
export function recordError(span: Span, error: Error): void {
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}
