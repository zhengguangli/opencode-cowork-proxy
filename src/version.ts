// Version string — auto-detected from git at runtime (Bun) or falls back to env/placeholder.
// Cloudflare Workers will use the fallback; standalone binary and dev server use the git hash.
export const VERSION: string = (() => {
  try {
    // @ts-ignore — Bun runtime (dev server + standalone binary)
    if (typeof Bun !== 'undefined') {
      const proc = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD']);
      if (proc.exitCode === 0) return proc.stdout.toString().trim();
    }
  } catch { /* git unavailable */ }
  try {
    return process.env.VERSION || 'dev';
  } catch { /* no process (Workers) */ }
  return 'dev';
})();
