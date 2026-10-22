#!/bin/bash
# install.sh —— 把防护 hook 安装到 .git/hooks（新 clone 后执行一次）
#
# 注意：时段闸 git-time-gate.sh 不随仓库分发（属私有工具仓），缺失时
# pre-push 对 pub 推送 fail-closed。请另行从私有工具仓 git-time-gate 安装。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
for h in pre-commit pre-merge-commit pre-rebase pre-push; do
  cp "hooks/$h" ".git/hooks/$h"
  chmod +x ".git/hooks/$h"
done
echo "✅ hooks 已安装"
if [ ! -x ".git/hooks/git-time-gate.sh" ]; then
  echo "⚠️  未找到 .git/hooks/git-time-gate.sh：pub 推送将被拒绝（fail-closed）。"
  echo "    请从私有工具仓 git-time-gate 安装时段闸。"
fi
