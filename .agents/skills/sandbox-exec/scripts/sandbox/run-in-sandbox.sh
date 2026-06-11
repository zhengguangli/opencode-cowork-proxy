#!/bin/bash
# Sandbox Exec — Run commands in isolated sandbox container
#
# Usage: ./run-in-sandbox.sh [--restricted] <command...>
#   --restricted   Use restricted network mode instead of full isolation
#
# Examples:
#   ./run-in-sandbox.sh bun test
#   ./run-in-sandbox.sh bun run src/index.ts
#   ./run-in-sandbox.sh --restricted npx wrangler whoami

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../../" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[sandbox-exec]${NC} $1"; }
warn() { echo -e "${YELLOW}[sandbox-exec]${NC} $1"; }
err()  { echo -e "${RED}[sandbox-exec]${NC} $1"; }

# Parse arguments
NETWORK_MODE="sandbox"  # default: full isolation
if [ "${1:-}" = "--restricted" ]; then
    NETWORK_MODE="sandbox-restricted"
    shift
fi

# Require a command
if [ $# -eq 0 ]; then
    err "Usage: $0 [--restricted] <command> [args...]"
    err "Example: $0 bun test"
    exit 1
fi

# Generate task ID
TASK_ID="run-$(date +%s)-$$"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    err "Docker is not installed or not in PATH."
    err "Install Docker Desktop: https://docs.docker.com/get-docker/"
    exit 1
fi

# Build the sandbox image if needed
IMAGE_EXISTS=$(docker images -q sandbox-exec:latest 2>/dev/null)
if [ -z "$IMAGE_EXISTS" ]; then
    log "Building sandbox image (first run)..."
    docker build \
        -t sandbox-exec:latest \
        -f "$SCRIPT_DIR/Dockerfile" \
        "$PROJECT_ROOT" || {
        err "Docker build failed. Check Dockerfile at: $SCRIPT_DIR/Dockerfile"
        exit 1
    }
    log "Sandbox image built."
fi

log "Running in sandbox (${NETWORK_MODE}): $*"
log "Task ID: ${TASK_ID}"

# Run in sandbox
docker compose \
    -f "$SCRIPT_DIR/docker-compose.sandbox.yml" \
    -p "sandbox-${TASK_ID}" \
    run --rm \
    -e TASK_ID="${TASK_ID}" \
    "${NETWORK_MODE}" \
    "$@"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    log "Command completed successfully (exit code: ${EXIT_CODE})"
else
    warn "Command exited with code: ${EXIT_CODE}"
fi

exit $EXIT_CODE
