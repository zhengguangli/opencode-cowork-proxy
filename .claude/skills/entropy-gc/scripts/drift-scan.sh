#!/usr/bin/env bash

# ============================================================================
# drift-scan — 漂移扫描
# 快速检测架构漂移、文档过期、品味违规
#
# 用法:
#   drift-scan.sh [--quick|--full]
#
# --quick  : 仅检查架构漂移和文档过期（默认，适合每日）
# --full   : 检查所有维度（适合每周）
# ============================================================================

MODE="${1:---quick}"
REPORT_FILE="${REPORT_FILE:-.workspace/drift-scan-$(date +%Y%m%d).md}"
errors=0
warnings=0

mkdir -p "$(dirname "$REPORT_FILE")"

cat > "$REPORT_FILE" <<EOF
# 漂移扫描报告

**日期:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")
**模式:** ${MODE}

EOF

# ─── 1. 架构漂移 ─────────────────────────────────
echo "## 架构漂移" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

if [[ -f "docs/ARCHITECTURE.md" ]]; then
  # 检查分层违规
  if [[ -d "src/types" ]] && [[ -d "src/services" ]]; then
    violations=$(grep -r "from.*services" src/types/ 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
    if [[ $violations -gt 0 ]]; then
      echo "- ❌ types 层导入了 services 层: ${violations} 处" >> "$REPORT_FILE"
      ((errors++))
    else
      echo "- ✅ 分层方向正确" >> "$REPORT_FILE"
    fi
  fi

  # 检查循环依赖
  if [[ -f "go.mod" ]] && command -v go &>/dev/null; then
    cycle_output=$(go vet ./... 2>&1 | grep -i "import cycle" || true)
    if [[ -n "$cycle_output" ]]; then
      echo "- ❌ 检测到循环依赖" >> "$REPORT_FILE"
      ((errors++))
    else
      echo "- ✅ 无循环依赖" >> "$REPORT_FILE"
    fi
  fi
else
  echo "- ⚠️ docs/ARCHITECTURE.md 不存在 — 无法检查架构漂移" >> "$REPORT_FILE"
  ((warnings++))
fi

echo "" >> "$REPORT_FILE"

# ─── 2. 文档漂移 ─────────────────────────────────
echo "## 文档漂移" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

stale_docs=0
for doc in docs/*.md; do
  if [[ -f "$doc" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      last_mod=$(stat -f %m "$doc")
    else
      last_mod=$(stat -c %Y "$doc")
    fi
    now=$(date +%s)
    age_days=$(( (now - last_mod) / 86400 ))
    if [[ $age_days -gt 30 ]]; then
      echo "- ⚠️ \`${doc}\` — ${age_days} 天未更新" >> "$REPORT_FILE"
      ((stale_docs++))
    fi
  fi
done

if [[ $stale_docs -eq 0 ]]; then
  echo "- ✅ 所有文档新鲜（<30 天）" >> "$REPORT_FILE"
else
  ((warnings += stale_docs))
fi

echo "" >> "$REPORT_FILE"

# ─── 3. 品味漂移（仅 full 模式）──────────────────
if [[ "$MODE" == "--full" ]]; then
  echo "## 品味漂移" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  # 文件大小检查
  large_files=0
  while IFS= read -r file; do
    lines=$(wc -l < "$file" | tr -d ' ')
    if [[ $lines -gt 500 ]]; then
      echo "- ⚠️ \`${file}\` — ${lines} 行（>500）" >> "$REPORT_FILE"
      ((large_files++))
    fi
  done < <(find . -maxdepth 5 \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/target/*" 2>/dev/null)

  if [[ $large_files -eq 0 ]]; then
    echo "- ✅ 无过大的文件" >> "$REPORT_FILE"
  else
    ((warnings += large_files))
  fi

  # TODO/FIXME 检查
  todo_count=0
  if command -v rg &>/dev/null; then
    todo_count=$(rg -c "TODO|FIXME" --type ts --type js --type py --type go --type rust -g '!node_modules' -g '!.git' . 2>/dev/null | awk -F: '{s+=$2}END{print s+0}')
  fi
  if [[ $todo_count -gt 20 ]]; then
    echo "- ⚠️ TODO/FIXME 过多: ${todo_count} 个" >> "$REPORT_FILE"
  else
    echo "- ✅ TODO/FIXME 数量正常 (${todo_count})" >> "$REPORT_FILE"
  fi

  echo "" >> "$REPORT_FILE"
fi

# ─── 4. 工具漂移（仅 full 模式）──────────────────
if [[ "$MODE" == "--full" ]]; then
  echo "## 工具漂移" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  # 检查未使用的依赖
  if [[ -f "package.json" ]] && command -v npx &>/dev/null; then
    echo "- ℹ️ 运行 \`npx depcheck\` 检查未使用的依赖" >> "$REPORT_FILE"
  fi

  if [[ -f "Cargo.toml" ]] && command -v cargo &>/dev/null; then
    echo "- ℹ️ 运行 \`cargo udeps\` 检查未使用的依赖" >> "$REPORT_FILE"
  fi

  echo "" >> "$REPORT_FILE"
fi

# ─── 汇总 ────────────────────────────────────────
echo "## 汇总" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- 错误: ${errors}" >> "$REPORT_FILE"
echo "- 警告: ${warnings}" >> "$REPORT_FILE"

echo "[drift-scan] 报告已生成: ${REPORT_FILE}"
echo "[drift-scan] 错误: ${errors}, 警告: ${warnings}"

if [[ $errors -gt 0 ]]; then
  exit 1
fi
exit 0
