import app from "./src/index";

const port = parseInt(process.env.PORT || "8787");

Bun.serve({
  port,
  fetch: async (req) => {
    const url = new URL(req.url);
    const method = req.method;
    const start = Date.now();
    try {
      const res = await app.fetch(req);
      const ms = Date.now() - start;
      console.log(`${method} ${url.pathname} ${res.status} ${ms}ms`);
      return res;
    } catch (err: any) {
      console.error(`${method} ${url.pathname} ERROR: ${err.message}`);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

console.log(`opencode-cowork-proxy listening on port ${port}`);
