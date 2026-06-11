#!/bin/bash
# Sandbox Exec — Convenience wrapper: run vitest tests in sandbox
#
# Usage: ./run-test-in-sandbox.sh [vitest-args...]
# Examples:
#   ./run-test-in-sandbox.sh                             # all tests
#   ./run-test-in-sandbox.sh test/auth.test.ts           # single test file
#   ./run-test-in-sandbox.sh -- --watch                  # watch mode (requires restricted)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../../" && pwd)"

GREEN='\033[0;32m'
NC='\033[0m'

log() { echo -e "${GREEN}[sandbox-exec]${NC} $1"; }

# Default: full isolation; pass --restricted for network access (e.g., watch mode)
EXTRA=""
if [ "${1:-}" = "--restricted" ]; then
    EXTRA="--restricted"
    shift
fi

log "Running tests in sandbox..."
exec "$SCRIPT_DIR/run-in-sandbox.sh" $EXTRA bun test "$@"
