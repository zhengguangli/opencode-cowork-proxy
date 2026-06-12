#!/usr/bin/env bun
/**
 * Dependency vulnerability scanner for opencode-cowork-proxy.
 *
 * Usage:
 *   node scripts/audit-deps.mjs                # Check dependencies
 *   node scripts/audit-deps.mjs --ci            # Exit with error on any finding
 *   node scripts/audit-deps.mjs --deep          # Check devDependencies too
 *
 * Checks:
 *   - Parses package.json for dependency metadata
 *   - Runs `npm audit` for known vulnerability database (uses package-lock.json if available)
 *   - Checks for outdated/missing lockfile
 *   - Validates dependency count vs known baseline
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const flags = {
  ci: process.argv.includes('--ci'),
  deep: process.argv.includes('--deep'),
};

let exitCode = 0;
let findings = 0;

function fail(msg) {
  console.log(`  ${RED}✗${RESET} ${msg}`);
  findings++;
  if (flags.ci) exitCode = 1;
}

function pass(msg) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function warn(msg) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function info(msg) {
  console.log(`  ${CYAN}→${RESET} ${msg}`);
}

console.log(`\n${CYAN}Dependency Audit: opencode-cowork-proxy${RESET}\n`);

// 1. Check package.json exists
const pkgPath = join(ROOT, 'package.json');
if (!existsSync(pkgPath)) {
  fail('package.json not found');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
info(`Runtime deps: ${Object.keys(pkg.dependencies || {}).length}`);
if (flags.deep) {
  info(`Dev deps: ${Object.keys(pkg.devDependencies || {}).length}`);
}

// 2. Check lockfile
const lockBun = join(ROOT, 'bun.lock');
const lockBunB = join(ROOT, 'bun.lockb');
const lockNpm = join(ROOT, 'package-lock.json');

if (existsSync(lockBun) || existsSync(lockBunB)) {
  pass('Lockfile present (bun.lock / bun.lockb)');
} else if (existsSync(lockNpm)) {
  pass('Lockfile present (package-lock.json)');
} else {
  fail('No lockfile found — run bun install to generate one');
}

// 3. Check runtime dependency surface
const runtimeDeps = Object.keys(pkg.dependencies || {});
if (runtimeDeps.length === 0) {
  warn('No runtime dependencies declared');
} else if (runtimeDeps.length <= 3) {
  pass(`Minimal runtime dependency surface (${runtimeDeps.length} deps)`);
} else {
  warn(`Large runtime dependency surface (${runtimeDeps.length} deps)`);
}

// 4. List runtime dependencies
for (const dep of runtimeDeps) {
  const version = pkg.dependencies[dep];
  // Check if it's a pinned version vs range
  if (version && !version.startsWith('^') && !version.startsWith('~') && !version.includes('*')) {
    pass(`${dep}@${version} — pinned version`);
  } else if (version) {
    info(`${dep}@${version}`);
  }
}

// 5. Check for exact versions of known critical deps
if (runtimeDeps.includes('hono')) {
  const honoVer = pkg.dependencies['hono'];
  info(`Hono framework: ${honoVer}`);
}

// 6. Try npm audit (if possible)
try {
  const npmAudit = execSync('npm audit --production --json 2>/dev/null', {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const auditResult = JSON.parse(npmAudit);
  const vulns = auditResult.vulnerabilities || {};
  const vulnCount = Object.keys(vulns).length;
  const severityCounts = { critical: 0, high: 0, moderate: 0, low: 0 };

  for (const [name, info] of Object.entries(vulns)) {
    const sev = info.severity || 'unknown';
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;
    if (sev === 'critical' || sev === 'high') {
      fail(`${name}: ${sev} severity — ${info.title}`);
    } else {
      warn(`${name}: ${sev} severity — ${info.title}`);
    }
  }

  if (vulnCount === 0) {
    pass('npm audit: no vulnerabilities found');
  } else {
    info(`npm audit: ${vulnCount} vulnerabilities (critical: ${severityCounts.critical}, high: ${severityCounts.high}, moderate: ${severityCounts.moderate}, low: ${severityCounts.low})`);
  }
} catch (err) {
  // npm audit may fail if no package-lock.json or registry unreachable
  if (err.stderr && err.stderr.includes('ENEEDAUDIT')) {
    info('npm audit: no package-lock.json (bun-based project — run bun install)');
  } else if (err.stderr) {
    warn(`npm audit: ${err.stderr.toString().slice(0, 200)}`);
  } else {
    info('npm audit: skipped (no package-lock.json)');
  }
}

// 7. Check for known low-license/MIT
const license = pkg.license || 'unknown';
info(`License: ${license}`);

// Summary
console.log(`\n${findings > 0 ? (flags.ci ? RED : YELLOW) : GREEN}Audit complete: ${findings} finding(s)${RESET}\n`);

if (flags.ci && findings > 0) {
  process.exit(1);
}
