#!/bin/bash
# Sandbox Exec — Container Entrypoint
# Enforces command allowlist and sets up environment before command execution

set -e

ALLOWLIST="/workspace/.agents/skills/sandbox-exec/scripts/sandbox/allowed-commands.txt"

# Extract the command to validate
if [ $# -eq 0 ]; then
    exec bash
fi

CMD_TO_RUN="$1"
CMD_BASENAME=$(basename "$CMD_TO_RUN")

# Check if command is in allowlist (skip check for shell and builtins)
if [ "$CMD_BASENAME" != "bash" ] && [ "$CMD_BASENAME" != "sh" ]; then
    if [ -f "$ALLOWLIST" ]; then
        # Check: exact match or allowlisted via pattern
        if ! grep -qxF "$CMD_BASENAME" "$ALLOWLIST" && ! grep -q "^${CMD_BASENAME}$" "$ALLOWLIST"; then
            echo "[sandbox-exec] ERROR: Command '${CMD_BASENAME}' is not in the allowlist."
            echo "[sandbox-exec] See: ${ALLOWLIST}"
            echo "[sandbox-exec] Allowed commands:"
            grep -v '^#' "$ALLOWLIST" | grep -v '^$' | sed 's/^/  - /'
            exit 1
        fi
    fi
fi

# Environment info
echo "[sandbox-exec] Task: ${TASK_ID:-default}"
echo "[sandbox-exec] Command: $*"
echo "[sandbox-exec] Allowlist: enabled"

# Execute the command
exec "$@"
