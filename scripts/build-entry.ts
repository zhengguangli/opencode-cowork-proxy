/**
 * Bun standalone HTTP server entry point.
 *
 * WHY READ THIS FILE: This is the local development / production entry point
 * for running the proxy as a standalone Bun binary.
 *
 * LOGGING: All HTTP access logging is handled by src/index.ts which calls
 * log.access() for every route. Logs go through Pino (stdout + optional file).
 * Tracing goes through OpenTelemetry (in-process or OTLP export).
 * Error monitoring goes through Sentry (when SENTRY_DSN is set).
 *
 * ENV CONFIGURATION:
 *   SENTRY_DSN   — Sentry Data Source Name for error monitoring
 *   SENTRY_ENV   — Environment tag (default: production)
 *   SENTRY_DEBUG — Set to "1" for Sentry debug output
 *
 * LOG FORMAT (from src/index.ts):
 *   {"level":"INFO","time":"...","service":"opencode-cowork-proxy","pfx":"HTTP",
 *    "msg":"GET /v1/models 200","req":"a1b2","details":{}}
 */
import app from "../src/index";
import { log } from "../src/logger";

// ---- Sentry initialization (early, before any imports that might error) ----

const SENTRY_DSN = process?.env?.SENTRY_DSN;
const SENTRY_ENV = process?.env?.SENTRY_ENV ?? 'production';

if (SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    tracesSampleRate: parseFloat(process?.env?.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    debug: !!(process?.env?.SENTRY_DEBUG),
  });
  log.info('SENTRY', `Sentry initialized: ${SENTRY_ENV}`, { environment: SENTRY_ENV });
}

const port = parseInt(process.env.PORT || "8787");

// The Hono app (src/index.ts) wraps every request with resolveContextIds() +
// withContextIds() via its app.all('*') middleware. This ensures all log calls
// inside the request handler have a proper trace_id + req. The fetch function
// here just delegates — context ID resolution happens inside the middleware.
Bun.serve({
  port,
  hostname: "0.0.0.0",
  idleTimeout: 30,
  maxRequestBodySize: 10 * 1024 * 1024, // 10MB — matches config.ts MAX_BODY_SIZE
  error: (error) => {
    if (SENTRY_DSN) {
      try {
        const Sentry = require('@sentry/node');
        Sentry.captureException(error);
      } catch {}
    }
    log.error('HTTP', `Unhandled error: ${error.message}`, { error: error.message });
    return new Response("Internal Server Error", { status: 500 });
  },
  fetch: (req) => app.fetch(req),
});

log.info('STARTUP', `opencode-cowork-proxy listening on port ${port}`, { port });
