/**
 * Bun standalone HTTP server entry point.
 *
 * WHY READ THIS FILE: This is the local development / production entry point
 * for running the proxy as a standalone Bun binary.
 *
 * LOGGING: All HTTP access logging is handled by src/index.ts which calls
 * log.access() for every route. The `req` field (request correlation ID) and
 * `trace_id` (session/trace identifier) are set here via resolveContextIds()
 * + withContextIds() and propagated through module-level variables to all
 * log calls inside app.fetch().
 *
 * LOG FORMAT (from src/index.ts):
 *   {"level":"INFO","ts":"...","pfx":"HTTP","msg":"POST /v1/messages 200 1384ms","req":"a1b2c3d4","trace_id":"my-session-001","details":{...}}
 */
import app from "../src/index";
import { log } from "../src/logger";

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
    log.error('HTTP', `Unhandled error: ${error.message}`, { error: error.message });
    return new Response("Internal Server Error", { status: 500 });
  },
  fetch: (req) => app.fetch(req),
});

log.info('STARTUP', `opencode-cowork-proxy listening on port ${port}`, { port });
