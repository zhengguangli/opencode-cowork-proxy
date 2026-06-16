/**
 * workspace.mjs — Shared workspace directory resolver
 *
 * Priority:
 *   1. HARNESS_WORKSPACE env var (user override, absolute path)
 *   2. Tool-specific project dir env var + '.harness-pilot'
 *   3. process.cwd() + '.harness-pilot'
 *
 * Supported env vars (by tool):
 *   - Claude Code: CLAUDE_PROJECT_DIR
 *   - Codex: CODEX_PROJECT_DIR
 *   - OpenCode: OPENCODE_PROJECT_DIR
 *   - Generic: PROJECT_DIR
 *
 * Usage:
 *   import { getWorkspaceDir, ensureWorkspace } from './scripts/lib/workspace.mjs'
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export function getWorkspaceDir(projectDir) {
  // 1. Explicit user override
  if (process.env.HARNESS_WORKSPACE) {
    return process.env.HARNESS_WORKSPACE;
  }

  // 2. Project dir from env or arg (check multiple tool env vars)
  const root = projectDir
    || process.env.CLAUDE_PROJECT_DIR
    || process.env.CODEX_PROJECT_DIR
    || process.env.OPENCODE_PROJECT_DIR
    || process.env.PROJECT_DIR
    || process.cwd();

  return join(root, '.harness-pilot');
}

export function ensureWorkspace(projectDir) {
  const dir = getWorkspaceDir(projectDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
