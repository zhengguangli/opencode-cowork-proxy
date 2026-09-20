/**
 * OpenTelemetry tracing — span creation, OTLP export, child span utilities.
 *
 * Spans are created for every request (root) and key phases. Export is
 * strictly opt-in: with no OTEL_* env vars set, no span processor is
 * installed, so span creation is pure in-memory bookkeeping with zero
 * per-request I/O.
 *
 * ENV CONFIGURATION:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTLP HTTP endpoint (e.g. http://jaeger:4318/v1/traces)
 *   OTEL_CONSOLE_EXPORT         — Set to "1" to print spans to the console (dev debugging)
 *   OTEL_SERVICE_NAME           — Service name in traces (default: opencode-cowork-proxy)
 *
 * WHEN TO READ THIS FILE: Adding new trace spans, configuring OTLP export.
 */
import { trace, context, Span, SpanStatusCode, Tracer } from '@opentelemetry/api';
import { BasicTracerProvider, BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
// Static ESM import, not require(): an ESM import is tree-shakeable (~21 KB
// instead of ~199 KB for the same exporter pulled in as CommonJS), and
// require() is unavailable on Cloudflare Workers.
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { log } from './log/logger';

const SERVICE_NAME = process?.env?.OTEL_SERVICE_NAME ?? 'opencode-cowork-proxy';
const SERVICE_VERSION = '2.1.5';
const otelEndpoint = process?.env?.OTEL_EXPORTER_OTLP_ENDPOINT;
const consoleExport = process?.env?.OTEL_CONSOLE_EXPORT === '1';

// Inlined from @opentelemetry/semantic-conventions — importing that package for
// this single constant pulled the whole conventions table into the bundle.
const ATTR_SERVICE_NAME = 'service.name';

const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    'service.version': SERVICE_VERSION,
  }),
  // No processor unless explicitly requested. The previous default
  // (ConsoleSpanExporter) serialised and synchronously wrote 2-3 spans on
  // every single request — pure overhead when nobody reads the console.
  spanProcessors: otelEndpoint
    ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: otelEndpoint }))]
    : consoleExport ? [new SimpleSpanProcessor(new ConsoleSpanExporter())] : [],
});

// Register as global tracer provider so trace.getTracer() returns our tracer
trace.setGlobalTracerProvider(provider);

if (otelEndpoint) {
  log.info('TRACING', `OTLP export enabled: ${otelEndpoint}`);
} else if (consoleExport) {
  log.info('TRACING', 'Console span export enabled (OTEL_CONSOLE_EXPORT=1)');
}

import { getRequestContext } from './log/context';

const TRACER: Tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

// ---- Async context-aware span tracking for utility functions ----

let fallbackSpan: Span | undefined;

/** Current root span for this request (read by safeUpstreamFetch, etc.). */
export function getCurrentSpan(): Span | undefined {
  const ctx = getRequestContext();
  return (ctx?.span as Span | undefined) ?? fallbackSpan;
}

/** Legacy export accessor */
export const currentSpan = {
  get value() { return getCurrentSpan(); },
  valueOf() { return getCurrentSpan(); },
};

/** Set the current span (used by index.ts before handler dispatch). */
export function setCurrentSpan(span: Span | undefined): void {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.span = span;
  } else {
    fallbackSpan = span;
  }
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
 * Start a child span under the given parent or the active request span.
 */
export function startSpan(name: string, parent?: Span): Span {
  const p = parent ?? getCurrentSpan();
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
  if (getCurrentSpan() === span) setCurrentSpan(undefined);
}

/**
 * Record an exception on a span and mark it as error.
 */
export function recordError(span: Span, error: Error): void {
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}

