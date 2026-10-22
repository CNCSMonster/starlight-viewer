#!/bin/bash
# pub-release.sh —— 把 main 上的一批私有迭代 squash 成单父发布 commit，推送到公开仓
#
# 用法：./pub-release.sh "发布标题"
# 流程：时段闸预检 → 查批次 → commit-tree 构造发布 commit（父=pub 现尖，树=main 树）
#       → 更新 pub → 自检树一致 → 推送 pub:main
# 说明：发布 commit 走 git commit-tree 管道构造，不切分支、不触发 pre-commit 冻结；
#       推送阶段 pre-push 四重闸 + 时段闸兜底，任何不一致自动拦截（fail-closed）。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

TITLE="${1:-}"
if [ -z "$TITLE" ]; then
  echo "用法: ./pub-release.sh \"发布标题\"" >&2
  exit 1
fi

# 时段闸前置检查（fail fast，避免白干一轮）
GATE="$(git rev-parse --absolute-git-dir)/hooks/git-time-gate.sh"
[ -x "$GATE" ] || { echo "⛔ 缺少时段闸 git-time-gate.sh，拒绝放行（fail-closed）。" >&2; exit 1; }
"$GATE"

# 发布只认已提交内容，脏工作区会被静默漏掉，显式拒绝
if [ -n "$(git status --porcelain)" ]; then
  echo "⛔ 工作区不干净，发布只认已提交内容。请先 commit / stash：" >&2
  git status --short >&2
  exit 1
fi

PUB_LOCAL=$(git rev-parse pub)
PUB_REMOTE=$(git rev-parse github/main 2>/dev/null || echo "$PUB_LOCAL")

if git diff --quiet pub main; then
  # 内容已追平：无新批次。若还有未推送的发布 commit（上次 push 失败），只补推不重建
  if [ "$PUB_LOCAL" = "$PUB_REMOTE" ]; then
    echo "ℹ️  pub 已与 main 一致且已推送，无待发布内容。"
    exit 0
  fi
  echo "ℹ️  发布 commit 已存在（上次推送未完成），补推。"
else
  BATCH=$(git log --oneline pub..main)
  echo "== 待发布批次（私有迭代，$(echo "$BATCH" | wc -l) 个提交）=="
  echo "$BATCH"

  NEW=$(git commit-tree main^{tree} -p pub -m "$TITLE" -m "本次发布汇总以下私有迭代：

$BATCH")
  git update-ref refs/heads/pub "$NEW"

  # 自检：发布 commit 的树必须与 main 完全一致
  if ! git diff --quiet pub main; then
    echo "⛔ 自检失败：pub 树与 main 不一致。pub 未推送，回滚：git update-ref -d refs/heads/pub" >&2
    exit 1
  fi
  echo "✅ 发布 commit: $(git rev-parse --short pub)"
fi

git push github pub:main
echo "✅ 已推送公开仓（GitHub main）"
