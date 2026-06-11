#!/bin/bash
# Sandbox Exec — Git Worktree Isolation
# Creates an independent git worktree for isolated task execution.
#
# Usage: ./create-worktree.sh <task-name>
# Example: ./create-worktree.sh feat-add-auth-test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../../" && pwd)"
WORKTREE_BASE="$PROJECT_ROOT/.worktrees"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[sandbox-exec]${NC} $1"; }
warn() { echo -e "${YELLOW}[sandbox-exec]${NC} $1"; }
err()  { echo -e "${RED}[sandbox-exec]${NC} $1"; }

# Validate task name
TASK_NAME="${1:-}"
if [ -z "$TASK_NAME" ]; then
    err "Usage: $0 <task-name>"
    err "Example: $0 fix-logging-bug"
    exit 1
fi

# Sanitize task name (replace non-alphanumeric chars with hyphens)
TASK_NAME=$(echo "$TASK_NAME" | sed 's/[^a-zA-Z0-9_-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
TASK_ID="${TASK_NAME}-$(date +%s)"
BRANCH_NAME="task/${TASK_NAME}"
WORKTREE_PATH="${WORKTREE_BASE}/${TASK_NAME}"

# Check for existing worktree
if [ -d "$WORKTREE_PATH" ]; then
    warn "Worktree already exists at ${WORKTREE_PATH}"
    warn "Use a different task name or clean up: git worktree remove ${WORKTREE_PATH}"
    exit 1
fi

log "=== Sandbox Worktree Isolation ==="
log "Task:     ${TASK_NAME}"
log "Branch:   ${BRANCH_NAME}"
log "Path:     ${WORKTREE_PATH}"
echo ""

# Ensure we're on main (or a clean base branch)
cd "$PROJECT_ROOT"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "$BRANCH_NAME" ]; then
    err "Already on branch ${BRANCH_NAME}. Switch to a base branch first."
    exit 1
fi

# Stash any uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Uncommitted changes detected. Stashing..."
    git stash push -m "sandbox-auto-stash-${TASK_NAME}" || true
fi

# Create the worktree with new branch
log "Creating worktree at ${WORKTREE_PATH} on branch ${BRANCH_NAME}..."
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" HEAD

log "Worktree created successfully!"
echo ""
log "To work in the worktree:"
log "  cd ${WORKTREE_PATH}"
echo ""
log "To run commands in sandbox:"
log "  docker compose -f ${PROJECT_ROOT}/.agents/skills/sandbox-exec/scripts/sandbox/docker-compose.sandbox.yml \\"
log "    -p sandbox-${TASK_NAME} \\"
log "    run --rm sandbox <command>"
echo ""
log "To run tests in sandbox (from worktree):"
log "  docker compose -f ${PROJECT_ROOT}/.agents/skills/sandbox-exec/scripts/sandbox/docker-compose.sandbox.yml \\"
log "    -p sandbox-${TASK_NAME} \\"
log "    run --rm sandbox bun test"
echo ""
log "To clean up after completion:"
log "  git worktree remove ${WORKTREE_PATH} && git branch -D ${BRANCH_NAME}"
