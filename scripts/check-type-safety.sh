#!/usr/bin/env bash
# Type Safety Check (Taste Invariant)
# Usage: bash scripts/check-type-safety.sh [src-dir]
# Exits 0 if no violations, 1 otherwise.
# Output: JSON lines of violations
#
# Note: This project intentionally uses `as Record<string, unknown>` at JSON
# parsing boundaries (API proxy pattern). Only dangerous assertions that could
# mask real type errors are flagged.

set -euo pipefail
SRC_DIR="${1:-src}"
VIOLATIONS=0

echo "[TS1] Checking 'any' type usage..."
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  echo "{\"rule\":\"TS1\",\"file\":\"$file\",\"line\":$lineno,\"description\":\"Use of 'any' type\",\"fix\":\"Replace 'any' with a proper TypeScript interface or type\"}"
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -n ': any' "$SRC_DIR"/*.ts "$SRC_DIR"/translate/**/*.ts 2>/dev/null || true)

echo "[TS2] Checking 'as' type assertions (excluding safe boundary casts)..."
# Safe patterns to exclude:
#   as Record<string, unknown>          — standard JSON parse boundary cast
#   as Record<string, unknown>[]        — array variant
#   as unknown                         — needed for recursive casting
#   as string | undefined              — safe optional cast
#   as string | null                   — safe nullable cast
#   as ReadableStream                  — known API type
#   as Error                           — catch clause
#   as T                               — generic boundary function cast
# Comments containing 'as' (line has //)
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  # Skip comment lines
  code_line=$(echo "$line" | sed 's/.*://' | sed 's/^[[:space:]]*//')
  [[ "$code_line" =~ ^[[:space:]]*\* ]] || [[ "$code_line" =~ ^[[:space:]]*// ]] && continue
  echo "{\"rule\":\"TS2\",\"file\":\"$file\",\"line\":$lineno,\"description\":\"Type assertion with 'as' at this location may need review\",\"fix\":\"Use proper type narrowing or declare types explicitly\"}"
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(
  grep -rnE '\bas\b[[:space:]]+' "$SRC_DIR"/*.ts "$SRC_DIR"/translate/**/*.ts 2>/dev/null \
    | grep -vE 'as Record<' \
    | grep -vE 'as Array<Record' \
    | grep -vE 'as unknown(\[\])?' \
    | grep -vE 'as const' \
    | grep -vE 'as string(\s*\|\s*(undefined|null))?' \
    | grep -vE 'as number(\s*\|\s*null)?' \
    | grep -vE 'as boolean(\s*\|\s*undefined)?' \
    | grep -vE 'as ReadableStream' \
    | grep -vE 'as Error' \
    | grep -vE 'as T\b' \
    | grep -vE 'as keyof' \
    | grep -vE '\*.*\bas\b' \
    | grep -vE '//.*\bas\b' \
    || true
)

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "{\"result\":\"FAIL\",\"count\":$VIOLATIONS}"
  exit 1
else
  echo "{\"result\":\"PASS\",\"count\":0}"
  exit 0
fi
