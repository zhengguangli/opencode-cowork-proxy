import app from "./src/index";

const port = parseInt(process.env.PORT || "18788");

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`opencode-cowork-proxy listening on port ${port}`);
