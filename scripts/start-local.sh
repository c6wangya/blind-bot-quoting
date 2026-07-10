#!/usr/bin/env bash
# 生产构建模式: 先 build 一次, 之后翻页零编译、秒开(连本地库)。
# 代价: 没有热更新——改了代码要重跑本脚本。适合"只想点着用/演示"。
# 日常改代码开发仍用 `npm run dev:local`。
set -e
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."

echo "① 容器运行时 (Colima)…"
colima status >/dev/null 2>&1 || colima start --cpu 2 --memory 4
docker context use colima >/dev/null 2>&1 || true
for _ in $(seq 1 30); do docker ps >/dev/null 2>&1 && break; sleep 1; done

echo "② Supabase 本地栈…"
supabase status >/dev/null 2>&1 || supabase start

echo "③ 切 .env.local → 本地库"
cp .env.local.localdev .env.local

echo "④ 生产构建 (一次性, 几分钟)…"
npm run build

echo "⑤ 启动 (http://localhost:3001, 翻页零编译)"
npx next start -p 3001
