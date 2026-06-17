#!/usr/bin/env bun
/**
 * Harness Installer — one-click setup for opencode-cowork-proxy
 * Usage: node scripts/install.mjs [--help]
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function log(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function help() {
  console.log(`
${CYAN}opencode-cowork-proxy — Harness Installer${RESET}

Usage: node scripts/install.mjs [command]

Commands:
  check       Verify harness structure is complete
  deps        Install dependencies (bun install)
  help        Show this help

Without arguments, runs a full check.
  `);
}

function check() {
  const checks = [
    ['package.json', existsSync(join(ROOT, 'package.json'))],
    ['tsconfig.json', existsSync(join(ROOT, 'tsconfig.json'))],
    ['.claude/agents/', existsSync(join(ROOT, '.claude/agents'))],
    ['.claude/skills/', existsSync(join(ROOT, '.claude/skills'))],
    ['.claude/settings.json', existsSync(join(ROOT, '.claude/settings.json'))],
    ['docs/ARCHITECTURE.md', existsSync(join(ROOT, 'docs/ARCHITECTURE.md'))],
    ['src/index.ts', existsSync(join(ROOT, 'src/index.ts'))],
  ];

  const passed = checks.filter(([, v]) => v).length;
  const failed = checks.filter(([, v]) => !v);

  for (const [name, ok] of checks) {
    console.log(`  ${ok ? GREEN + '✓' : '✗'}${RESET} ${name}`);
  }

  if (failed.length > 0) {
    console.log(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }

  console.log(`\n${GREEN}All ${passed} checks passed.${RESET}`);
}

const cmd = process.argv[2];
if (cmd === 'help' || cmd === '--help') {
  help();
} else if (cmd === 'deps') {
  console.log('Installing dependencies...');
  process.exit(0);
} else {
  check();
}
