/**
 * Bun standalone HTTP server entry point.
 *
 * WHY READ THIS FILE: This is the local development / production entry point
 * for running the proxy as a standalone Bun binary. All HTTP access logging
 * goes through the unified logger.ts for consistent JSON output.
 *
 * LOG FORMAT:
 *   {"level":"INFO","ts":"...","pfx":"HTTP","msg":"POST /v1/messages 200 1384ms","req":"a1b2c3d4","details":{"method":"POST","path":"/v1/messages","status":200,"durationMs":1384}}
 *
 * The `req` field is a per-request ID generated here and propagated via
 * AsyncLocalStorage in logger.ts. src/index.ts detects the existing context
 * and reuses the same ID for all internal log calls.
 */
import app from "../src/index";
import { log, generateId, withRequestId } from "../src/logger";

const port = parseInt(process.env.PORT || "8787");

Bun.serve({
  port,
  hostname: "0.0.0.0",
  idleTimeout: 30,
  maxRequestBodySize: 1024 * 1024, // 1MB
  error: (error) => {
    log.error('HTTP', `Unhandled error: ${error.message}`, { error: error.message });
    return new Response("Internal Server Error", { status: 500 });
  },
  fetch: async (req) => {
    const reqId = generateId();
    return withRequestId(reqId, async () => {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;
      const start = performance.now();
      const res = await app.fetch(req);
      const ms = Math.round(performance.now() - start);
      log.access(method, path, res.status, ms);
      return res;
    });
  },
});

log.info('STARTUP', `opencode-cowork-proxy listening on port ${port}`, { port });
