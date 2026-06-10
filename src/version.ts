/**
 * Unified version string — reads from package.json at build/bundle time.
 *
 * WHEN TO READ THIS FILE: Bumping the version number (change it in package.json,
 * this is a pure re-export), or debugging version resolution across runtimes.
 */
// Works across all deployment targets:
//   - Bun dev server      → bundle-time resolve
//   - Bun standalone binary → compile-time bundle
//   - Cloudflare Workers   → wrangler (esbuild) handles JSON imports natively
//   - Vercel serverless    → same bundle-time resolve
import pkg from '../package.json';

export const VERSION: string = pkg.version;
