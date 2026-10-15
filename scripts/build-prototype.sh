#!/usr/bin/env bash
# 原型构建：把客户端（/）和后台（/admin/）合并成一个静态站点，输出到 dist/。
# Vercel 用它构建原型预览（vercel.json 的 buildCommand）；本地也可以直接运行。
set -euo pipefail
cd "$(dirname "$0")/.."
for app in client admin; do
  echo "== 构建 web/$app"
  npm ci --prefix "web/$app" --no-audit --no-fund
  npm run build --prefix "web/$app"
done
rm -rf dist
mkdir -p dist/admin
cp -R web/client/dist/. dist/
cp -R web/admin/dist/. dist/admin/
echo "== 原型站点已生成：dist/（客户端 /，后台 /admin/）"
