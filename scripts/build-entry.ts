/**
 * Bun standalone HTTP server entry point.
 *
 * WHY READ THIS FILE: This is the local development / production entry point
 * for running the proxy as a standalone Bun binary. All HTTP access logging
 * goes through the unified logger.ts for consistent JSON output.
 *
 * LOG FORMAT:
 *   {"level":"INFO","ts":"...","pfx":"HTTP","msg":"POST /v1/messages 200 1384ms","details":{"method":"POST","path":"/v1/messages","status":200,"durationMs":1384}}
 */
import app from "../src/index";
import { log } from "../src/logger";

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
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;
    const start = performance.now();

    const res = await app.fetch(req);
    const ms = Math.round(performance.now() - start);
    log.access(method, path, res.status, ms);
    return res;
  },
});

log.info('STARTUP', `opencode-cowork-proxy listening on port ${port}`, { port });
