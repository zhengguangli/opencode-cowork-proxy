#!/usr/bin/env bash
# Architecture Layer Dependency Check (L1-L5)
# Usage: bash scripts/check-layers.sh [src-dir]
# Exits 0 if no violations, 1 if violations found.
# Output: JSON lines of violations

set -euo pipefail
SRC_DIR="${1:-src}"
VIOLATIONS=0

check_import_not() {
  local file="$1" rule="$2" desc="$3" target="$4"
  while IFS=: read -r lineno line; do
    if echo "$line" | grep -qE "$target"; then
      echo "{\"rule\":\"$rule\",\"file\":\"$file\",\"line\":$lineno,\"description\":\"$desc\",\"fix\":\"Remove import of '$target' from $file\"}"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < <(grep -n "^import " "$file" 2>/dev/null || true)
}

echo "[L1] Checking translate modules do not import request.ts or index.ts..."
for f in "$SRC_DIR"/translate/**/*.ts; do
  [ -f "$f" ] || continue
  check_import_not "$f" "L1" "Translate module must not import request" "\.\.\/\.\.\/request"
  check_import_not "$f" "L1" "Translate module must not import index" "\.\.\/\.\.\/index"
done

echo "[L2] Checking request.ts does not import translate modules..."
check_import_not "$SRC_DIR/request.ts" "L2" "request.ts must not import translate modules" "translate"

echo "[L3] Checking utilities do not import translate, request, or index..."
for f in routing.ts auth.ts vision.ts; do
  ff="$SRC_DIR/$f"
  [ -f "$ff" ] || continue
  check_import_not "$ff" "L3" "Utility must not import translate" "translate"
  check_import_not "$ff" "L3" "Utility must not import request" "request"
  check_import_not "$ff" "L3" "Utility must not import index" "index"
done

echo "[L5] Checking entry points only import index.ts..."
for f in server.ts api/\[\[...route\]\].ts; do
  [ -f "$f" ] || continue
  while IFS= read -r line; do
    # Allow ./src/index or ../src/index
    if echo "$line" | grep -qE "(\.\/src\/index|\.\.\/src\/index)"; then
      continue
    fi
    # Flag any import from src/ that is NOT src/index
    if echo "$line" | grep -qE "src/"; then
      lineno=$(echo "$line" | cut -d: -f1)
      echo "{\"rule\":\"L5\",\"file\":\"$f\",\"line\":$lineno,\"description\":\"Entry point imports non-index module from src/\",\"fix\":\"Entry point should only import from src/index.ts\"}"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < <(grep -n "^import " "$f" 2>/dev/null || true)
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "{\"result\":\"FAIL\",\"count\":$VIOLATIONS}"
  exit 1
else
  echo "{\"result\":\"PASS\",\"count\":0}"
  exit 0
fi
