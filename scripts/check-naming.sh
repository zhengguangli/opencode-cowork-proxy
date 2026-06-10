#!/usr/bin/env bash
# Naming Convention Check (M1, N1-N4)
# Usage: bash scripts/check-naming.sh [src-dir]
# Exits 0 if no violations, 1 otherwise.
# Output: JSON lines of violations

set -euo pipefail
SRC_DIR="${1:-src}"
VIOLATIONS=0

echo "[N1/N2] Checking request/response translator naming format{Source}To{Target}..."
for f in "$SRC_DIR"/translate/request/*.ts "$SRC_DIR"/translate/response/*.ts; do
  [ -f "$f" ] || continue
  basename=$(basename "$f" .ts)
  # Extract export function name
  func=$(grep -n "^export function " "$f" | head -1 || true)
  if [ -n "$func" ]; then
    fname=$(echo "$func" | sed 's/.*export function \([a-zA-Z]*\)(.*/\1/')
    if ! echo "$fname" | grep -qE '^format[A-Z]'; then
      echo "{\"rule\":\"N1\",\"file\":\"$f\",\"line\":$(echo "$func" | cut -d: -f1),\"description\":\"Request/response translator should be named format{Source}To{Target}, got $fname\",\"fix\":\"Rename function to format...To... based on its source/target format\"}"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done

echo "[N3] Checking stream translator naming stream{Source}To{Target}..."
for f in "$SRC_DIR"/translate/stream/*.ts; do
  [ -f "$f" ] || continue
  func=$(grep -n "^export function " "$f" | head -1 || true)
  if [ -n "$func" ]; then
    fname=$(echo "$func" | sed 's/.*export function \([a-zA-Z]*\)(.*/\1/')
    if ! echo "$fname" | grep -qE '^stream[A-Z]'; then
      echo "{\"rule\":\"N3\",\"file\":\"$f\",\"line\":$(echo "$func" | cut -d: -f1),\"description\":\"Stream translator should be named stream{Source}To{Target}, got $fname\",\"fix\":\"Rename function to stream...To...\"}"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done

echo "[N4] Checking file names match {source}-to-{target}.ts pattern..."
for f in "$SRC_DIR"/translate/**/*.ts; do
  [ -f "$f" ] || continue
  basename=$(basename "$f" .ts)
  if ! echo "$basename" | grep -qE '^[a-z][a-z-]+-to-[a-z][a-z-]+$'; then
    echo "{\"rule\":\"N4\",\"file\":\"$f\",\"description\":\"Translation file should be named {source}-to-{target}.ts, got $basename\",\"fix\":\"Rename file to match the pattern\"}"
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
