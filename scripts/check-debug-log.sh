#!/usr/bin/env bash
# Debug Log Check (Taste Invariant — structured logging)
# Usage: bash scripts/check-debug-log.sh [src-dir]
# Exits 0 if no violations, 1 otherwise.
# Output: JSON lines of violations (excluding IS_DEBUG-gated logs)
#
# Uses awk state machine to track if console.log/error is inside
# an `if (IS_DEBUG)` block.

set -euo pipefail
SRC_DIR="${1:-src}"
VIOLATIONS=0

echo "[DL1] Checking non-gated console.log/console.error in production code..."

find "$SRC_DIR" -name '*.ts' -print0 | while IFS= read -r -d '' FILE; do
  awk '
    BEGIN { in_debug = 0; depth = 0; start_nr = -1 }
    {
      line_has_console = /console\.(log|error|warn|debug)/

      if (/if[[:space:]]*\([[:space:]]*IS_DEBUG/) {
        in_debug = 1
        start_nr = NR
        depth = 0
        # Count braces on this line
        for (i = 1; i <= length($0); i++) {
          c = substr($0, i, 1)
          if (c == "{") depth++
          if (c == "}") depth--
        }
        next  # No further checks for the IS_DEBUG line itself
      }

      if (in_debug) {
        for (i = 1; i <= length($0); i++) {
          c = substr($0, i, 1)
          if (c == "{") depth++
          if (c == "}") depth--
        }
        if (NR > start_nr && depth <= 0) {
          in_debug = 0
          next
        }
        # If still in_debug, skip console checking (this line is gated)
        if (line_has_console) next
      }

      if (line_has_console) {
        printf "{\"rule\":\"DL1\",\"file\":\"%s\",\"line\":%d,\"description\":\"Non-gated console.log or console.error in production code\",\"fix\":\"Gate behind IS_DEBUG flag, or remove if debug-only\"}\n", FILENAME, NR
      }
    }
  ' "$FILE"
done | {
  VIOLATIONS=0
  while IFS= read -r JSON; do
    echo "$JSON"
    VIOLATIONS=$((VIOLATIONS + 1))
  done
  if [ "$VIOLATIONS" -gt 0 ]; then
    echo "{\"result\":\"WARN\",\"count\":$VIOLATIONS}"
  else
    echo "{\"result\":\"PASS\",\"count\":0}"
  fi
  exit 0
}
