/**
 * Bun standalone HTTP server entry point.
 *
 * WHY READ THIS FILE: This is the local development / production entry point
 * for running the proxy as a standalone Bun binary.
 *
 * LOGGING: All HTTP access logging is handled by src/index.ts which calls
 * log.access() for every route. The `req` field (request correlation ID) is
 * set here via withRequestId() and propagated through AsyncLocalStorage to
 * all log calls inside app.fetch().
 *
 * LOG FORMAT (from src/index.ts):
 *   {"level":"INFO","ts":"...","pfx":"HTTP","msg":"POST /v1/messages 200 1384ms","req":"a1b2c3d4","details":{...}}
 */
import app from "../src/index";
import { log, generateId, withRequestId } from "../src/logger";

const port = parseInt(process.env.PORT || "8787");

Bun.serve({
  port,
  hostname: "0.0.0.0",
  idleTimeout: 30,
  maxRequestBodySize: 10 * 1024 * 1024, // 10MB — matches config.ts MAX_BODY_SIZE
  error: (error) => {
    log.error('HTTP', `Unhandled error: ${error.message}`, { error: error.message });
    return new Response("Internal Server Error", { status: 500 });
  },
  fetch: async (req) => {
    // Set request_id context so all log calls inside app.fetch() share the same req
    const reqId = generateId();
    return withRequestId(reqId, () => app.fetch(req));
  },
});

log.info('STARTUP', `opencode-cowork-proxy listening on port ${port}`, { port });
