#!/usr/bin/env bash
# 本地开发一键启动: 容器 → Supabase 本地栈 → 切 env → dev server
# 幂等: 已经起了的步骤会自动跳过。用法: npm run dev:local
set -e
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."

echo "① 检查容器运行时 (Colima)…"
# 2CPU/4GB 足够跑空闲的 Supabase 容器(实测仅用 ~1.2GB); 更多内存留给 Next 编译,
# 否则 16GB Mac 会 swap 导致 Turbopack 编译从几秒暴涨到上百秒。
colima status >/dev/null 2>&1 || colima start --cpu 2 --memory 4
# colima stop 会把 docker context 切回 default(→连 /var/run/docker.sock 失败), 每次强制切回
docker context use colima >/dev/null 2>&1 || true
# 等 docker 守护就绪(刚 start 时需要几秒), 避免 supabase 连不上
for _ in $(seq 1 30); do docker ps >/dev/null 2>&1 && break; sleep 1; done

echo "② 检查 Supabase 本地栈…"
supabase status >/dev/null 2>&1 || supabase start

echo "③ 切换 .env.local → 本地库"
cp .env.local.localdev .env.local

echo "④ 启动 dev server (http://localhost:3001)"
npm run dev -- -p 3001
