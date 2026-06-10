#!/usr/bin/env bash

# ============================================================================
# quality-score — 质量评分
# 为每个产品领域和架构层计算质量评分
#
# 用法:
#   quality-score.sh
#
# 输出: .workspace/quality-score-YYYYMMDD.md
# ============================================================================

REPORT_FILE="${REPORT_FILE:-.workspace/quality-score-$(date +%Y%m%d).md}"
mkdir -p "$(dirname "$REPORT_FILE")"

# 收集指标
collect() {
  # 文件数
  local file_count=$(find . -maxdepth 5 \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/target/*" 2>/dev/null | wc -l | tr -d ' ')

  # TODO 数
  local todo_count=0
  if command -v rg &>/dev/null; then
    todo_count=$(rg -c "TODO|FIXME" --type ts --type js --type py --type go --type rust -g '!node_modules' -g '!.git' . 2>/dev/null | awk -F: '{s+=$2}END{print s+0}')
  fi

  # 大文件数
  local large_files=0
  while IFS= read -r file; do
    lines=$(wc -l < "$file" | tr -d ' ')
    if [[ $lines -gt 500 ]]; then
      ((large_files++))
    fi
  done < <(find . -maxdepth 5 \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/target/*" 2>/dev/null)

  # 测试文件数
  local test_files=$(find . -maxdepth 5 \( -name "*.test.*" -o -name "*.spec.*" -o -name "*_test.*" \) ! -path "*/node_modules/*" ! -path "*/.git/*" 2>/dev/null | wc -l | tr -d ' ')

  # 文档数
  local doc_files=$(find docs -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

  # Git 活跃度
  local recent_commits=$(git log --oneline -30 2>/dev/null | wc -l | tr -d ' ')

  echo "$file_count $todo_count $large_files $test_files $doc_files $recent_commits"
}

read -r file_count todo_count large_files test_files doc_files recent_commits <<< "$(collect)"

# 计算评分（0-10）
score_file_size() {
  if [[ $large_files -eq 0 ]]; then echo 10
  elif [[ $large_files -le 2 ]]; then echo 8
  elif [[ $large_files -le 5 ]]; then echo 6
  else echo 4; fi
}

score_todo() {
  if [[ $todo_count -eq 0 ]]; then echo 10
  elif [[ $todo_count -le 10 ]]; then echo 9
  elif [[ $todo_count -le 20 ]]; then echo 7
  elif [[ $todo_count -le 50 ]]; then echo 5
  else echo 3; fi
}

score_test_coverage() {
  if [[ $file_count -eq 0 ]]; then echo "N/A"; return; fi
  local ratio=$((test_files * 100 / file_count))
  if [[ $ratio -ge 80 ]]; then echo 10
  elif [[ $ratio -ge 50 ]]; then echo 8
  elif [[ $ratio -ge 30 ]]; then echo 6
  elif [[ $ratio -ge 10 ]]; then echo 4
  else echo 2; fi
}

score_docs() {
  if [[ $doc_files -ge 10 ]]; then echo 10
  elif [[ $doc_files -ge 5 ]]; then echo 8
  elif [[ $doc_files -ge 3 ]]; then echo 6
  elif [[ $doc_files -ge 1 ]]; then echo 4
  else echo 2; fi
}

score_architecture() {
  if [[ -f "docs/ARCHITECTURE.md" ]]; then echo 8; else echo 3; fi
}

# 生成报告
cat > "$REPORT_FILE" <<EOF
# 质量评分报告

**日期:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## 总览

| 指标 | 值 |
|------|-----|
| 源文件数 | ${file_count} |
| 测试文件数 | ${test_files} |
| 文档数 | ${doc_files} |
| TODO/FIXME | ${todo_count} |
| 大文件(>500行) | ${large_files} |
| 近30天提交 | ${recent_commits} |

## 评分

| 维度 | 评分 (0-10) | 说明 |
|------|------------|------|
| 文件大小 | $(score_file_size) | ${large_files} 个大文件 |
| 技术债务 | $(score_todo) | ${todo_count} 个 TODO/FIXME |
| 测试覆盖 | $(score_test_coverage) | ${test_files} 个测试文件 / ${file_count} 个源文件 |
| 文档完整性 | $(score_docs) | ${doc_files} 个文档 |
| 架构定义 | $(score_architecture) | $([ -f docs/ARCHITECTURE.md ] && echo "已定义" || echo "缺失") |

## 建议

EOF

# 生成建议
if [[ $large_files -gt 0 ]]; then
  echo "- 拆分 ${large_files} 个大文件（>500 行）" >> "$REPORT_FILE"
fi
if [[ $todo_count -gt 20 ]]; then
  echo "- 清理 ${todo_count} 个 TODO/FIXME" >> "$REPORT_FILE"
fi
if [[ ! -f "docs/ARCHITECTURE.md" ]]; then
  echo "- 创建 docs/ARCHITECTURE.md 定义架构边界" >> "$REPORT_FILE"
fi
if [[ $doc_files -lt 5 ]]; then
  echo "- 补充文档（当前仅 ${doc_files} 个）" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
echo "[quality-score] 报告已生成: ${REPORT_FILE}"
