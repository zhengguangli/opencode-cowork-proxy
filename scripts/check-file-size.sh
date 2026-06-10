#!/usr/bin/env bash
# File Size Check (M3)
# Usage: bash scripts/check-file-size.sh [src-dir] [max-lines]
# Exits 0 if no violations, 1 otherwise.
# Output: JSON lines of violations

set -euo pipefail
SRC_DIR="${1:-src}"
MAX_LINES="${2:-500}"
VIOLATIONS=0

echo "[M3] Checking files do not exceed $MAX_LINES lines..."

for f in "$SRC_DIR"/*.ts "$SRC_DIR"/translate/**/*.ts; do
  [ -f "$f" ] || continue
  lines=$(wc -l < "$f")
  if [ "$lines" -gt "$MAX_LINES" ]; then
    echo "{\"rule\":\"M3\",\"file\":\"$f\",\"lines\":$lines,\"max\":$MAX_LINES,\"description\":\"File exceeds line limit\",\"fix\":\"Refactor $f into smaller modules or extract helper functions\"}"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "{\"result\":\"FAIL\",\"count\":$VIOLATIONS}"
  exit 1
else
  echo "{\"result\":\"PASS\",\"count\":0}"
  exit 0
fi
