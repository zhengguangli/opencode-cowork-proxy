#!/usr/bin/env bun
/**
 * Lightweight load testing script for opencode-cowork-proxy.
 *
 * Usage:
 *   node scripts/load-test.mjs              # Quick smoke test (10 req, 1 concurrency)
 *   node scripts/load-test.mjs --requests 100 --concurrency 5  # Moderate load
 *   node scripts/load-test.mjs --duration 30 --concurrency 10  # 30s sustained load
 *
 * Tests /v1/chat/completions with a simple prompt. Requires a running proxy
 * instance and a valid API key in OPENCODE_API_KEY env var.
 *
 * Outputs: p50/p90/p99 latency, error rate, requests/sec.
 */
const TARGET = process.env.TARGET_URL || 'http://localhost:18787';
const API_KEY = process.env.OPENCODE_API_KEY || 'x'.repeat(32);

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
    flags[key] = val;
    if (val !== true) i++;
  }
}

const NUM_REQUESTS = parseInt(flags.requests, 10) || 10;
const CONCURRENCY = parseInt(flags.concurrency, 10) || 1;
const DURATION = parseInt(flags.duration, 10) || 0; // 0 = fixed count mode
const PATH = flags.path || '/v1/chat/completions';

const PAYLOAD = JSON.stringify({
  model: 'deepseek-v4-pro',
  messages: [{ role: 'user', content: 'Say hello in one word.' }],
  max_tokens: 10,
});

async function sendRequest(url) {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: PAYLOAD,
      signal: AbortSignal.timeout(30_000),
    });
    const elapsed = performance.now() - start;
    const ok = res.ok;
    const text = await res.text();
    return { ok, status: res.status, elapsed, body: text.slice(0, 100) };
  } catch (err) {
    return { ok: false, status: 0, elapsed: performance.now() - start, error: err.message };
  }
}

async function run() {
  const url = `${TARGET}${PATH}`;
  console.log(`\n🚀 Load Test: opencode-cowork-proxy`);
  console.log(`   Target:     ${url}`);
  console.log(`   Requests:   ${DURATION ? `~${CONCURRENCY * 10}/s for ${DURATION}s` : NUM_REQUESTS}`);
  console.log(`   Concurrency: ${CONCURRENCY}`);
  console.log(`   Path:       ${PATH}`);
  console.log(`   Timeout:    30s\n`);

  const results = [];
  const latencies = [];
  let errors = 0;
  const startTime = Date.now();
  const endTime = DURATION ? startTime + DURATION * 1000 : Infinity;
  const targetTotal = DURATION ? Infinity : NUM_REQUESTS;
  let completed = 0;

  async function worker() {
    while (completed < targetTotal && Date.now() < endTime) {
      const result = await sendRequest(url);
      results.push(result);
      latencies.push(result.elapsed);
      if (!result.ok) errors++;
      completed++;
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const realDuration = (Date.now() - startTime) / 1000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p90 = latencies[Math.floor(latencies.length * 0.9)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const rps = completed / realDuration;

  console.log(`📊 Results (${completed} requests in ${realDuration.toFixed(1)}s):`);
  console.log(`   Avg latency:  ${avg.toFixed(0)}ms`);
  console.log(`   p50 latency:  ${p50.toFixed(0)}ms`);
  console.log(`   p90 latency:  ${p90.toFixed(0)}ms`);
  console.log(`   p99 latency:  ${p99.toFixed(0)}ms`);
  console.log(`   Requests/s:   ${rps.toFixed(1)}`);
  console.log(`   Errors:       ${errors} (${(errors / completed * 100).toFixed(1)}%)`);

  // Status code distribution
  const statusDist = {};
  for (const r of results) {
    const key = r.status || 'error';
    statusDist[key] = (statusDist[key] || 0) + 1;
  }
  console.log(`\n   Status codes:`);
  for (const [code, count] of Object.entries(statusDist).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`     ${code}: ${count}`);
  }

  process.exit(errors > 0 && errors === completed ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
