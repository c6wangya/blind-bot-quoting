# THE-772 集成 — 进度与交接文档（Session Handoff）

> 目的：把本 session 的**全部上下文**沉淀下来,供下一个 session（可能在公司另开）无缝接手。
> 最后更新：2026-06-15 · quote 仓库 PR #1 **已合入 `main`**;之后 **quotes/orders/pricing 已从 SQLite 迁到 Supabase/Postgres**（分支 `yanyan/the-772-postgres-migration`,better-sqlite3 已移除）。shared-ui 的按钮改动在分支 `yanyan/the-772-quote-handoff-button`（未合）。

---

## 0. 一分钟全景

我们在把两个系统连起来:**blind-bot 安装器（installer）** 和一个独立的 **quote 报价服务**。
目标流程:零售商在 installer 配出渲染结果 → 点按钮跳到 quote 服务 → 登录/注册（白标,看起来像"另一家公司"）→ 自动按邮箱关联 blind-bot 账号 → 落到配置器,带过来的 result 图 + 选配已就位 → 报价 / 预订单。

**当前已能跑通（quote 侧端到端）**:模拟 handoff URL → 登录闸 → Google/邮箱登录 → 落配置器看到 "Carried over" 设计图。唯一需要真人操作的是交互式登录。

**4 个相关仓库**（都在 `C:\Users\PC\Documents\`）:
- `blind-bot-quoting` —— 报价服务（**本仓库,主战场**;Next.js 16 + React 19 + TS + Tailwind v4 + SQLite + 新增 Supabase）
- `blind-bot-frontend` —— blind-bot 安装器前端（Next.js 16；Supabase + Google 登录）
- `blind-bot-shared-ui` —— 共享组件库（installer 的 ResultStep 在这里;GitHub tag + yalc 消费）
- `blind-bot-server` —— blind-bot 后端（Node/Express + Supabase/Postgres;有 `clients`、`render_history` 表、`/lookup-api-key`、`/init-account`）

---

## 🚀 新机器 / 新 session 怎么接手（office cold-start → 接着开发）

> **给新 Claude session 的第一句话**(直接复制):
> 「先读 `THE-772-PROGRESS.md` 和 `docs/superpowers/specs/` 下两份 spec —— 这是上个 session 的完整上下文。然后帮我按文档把 quote 服务在本机跑起来（端口 3001），跑通后我们接着做第 7 节的下一步。」

### A. 把它跑起来（从零到能登录）
1. `git clone` / `git pull`。
2. **重建 `.env.local`**（⚠️ 最容易卡住、且现在是**必需**的——数据层已迁 Postgres，没有 Supabase env 整个 app 都跑不起来）：按第 4 节的 5 个变量填；两把 Supabase key 从 Supabase 控制台复制，或把上一台机器的 `.env.local` 安全拷过来。
3. `npm install`（better-sqlite3 已移除，**不再需要**那个预编译二进制步骤了）。
4. `npm run dev -- -p 3001`（**必须 3001**）。
5. 验证：开 `http://localhost:3001/login` 应看到全屏登录页；首页/目录/报价/订单都正常（数据来自 Postgres，首次请求自动 seed 2 条历史订单）。
   - 云端前置（Supabase 项目 / Google OAuth / 已建好的 6 张表）是**共享的、一直在**，不用重建。

> 跑不起来先查这几样：`.env.local` 是否齐全、`NEXT_PUBLIC_SUPABASE_URL` 是否 `.supabase.co` 结尾（不是 dashboard 链接）、端口是不是 3001、better-sqlite3 二进制是否就位。
> 没有 `.env.local` 也能跑（auth 会自动关闭、不崩），只是登录不可用。

### B. 接着开发（回来第一件事）
1. **真人登一次**（Google 或邮箱）→ 确认 Supabase `profiles` 建行、同邮箱时 `blindbot_linked_at` 有值。**这是唯一还没真人验证过的环节。**
2. 然后按**第 7 节的优先级**推进（通常下一大块是：把 quotes/orders 迁 Postgres，或做真实变体映射）。

---

## 1. 拆解:4 个子项目 + 1 条白标横切线

| # | 子项目 | 状态 | 说明 |
|---|---|---|---|
| 1 | 跳转 + 数据交接 | 🟡 skeleton 完成 | blind-bot 结果页按钮（flag-gated）→ quote `/configure/<默认款>?line&img&cfg`,inline 参数传递（方案 ii）。正式形态 (i)（id + 回调取数）推迟 |
| 2 | quote 登录/注册页 | 🟢 phase 1 完成 | Google + 邮箱登录,白标登录页（全屏、无侧边栏）。"Continue with BlindBot" 推迟到 phase 2 |
| 3 | 跨系统开通 + 按邮箱关联 | 🟢 phase 1 完成 | 登录后建 `profiles` 行 + 调 blind-bot `/lookup-api-key` 按邮箱关联（只记标记,不存 api_key） |
| 4 | 结果→配置器导入 + 变体映射 | 🟡 skeleton 完成 | 导入图 + 选配,落到产品线默认款。**真实的产品/颜色/遮光映射 + 自动预选仍未做**（`lib/import.ts` 的 `mapImportedConfig` 是 no-op 接缝） |
| — | 白标（去 BlindBot 化）横切 | 🟡 部分 | 已做:中性参数名/文案/noreferrer/feature flag、登录页全屏去 chrome、tab 标题改 "Trade Portal"。**未做:侧边栏 logo 仍是 BlindBots、整体改名换色、图片代理、id 化 handoff** |

**连调（本 session 末尾完成）**:把 1 和 2/3 串起来——handoff 进来若未登录,先跳登录页（`/login?next=<原 handoff URL>`),登录后原样返回配置器并导入设计。普通浏览（catalog→configure 无导入参数）不强制登录。

---

## 2. 关键决策记录（含我替你做的自主决策）

**brainstorming 阶段定的:**
- 架构选 **B**:quote 自建独立身份（不复用 blind-bot 的 Supabase）——为了白标干净（Google 授权页显示 quote 品牌而非 BlindBot）。
- auth + 数据都走 **Supabase**(quote 自己的项目);现有 quotes/orders 暂留 SQLite,**下一步再迁 Postgres**。
- 导入定位为 **best-effort**,不追求 100% 还原;skeleton 阶段**只展示**带过来的设计、不自动预选（自动预选 = 被推迟的变体映射）。
- handoff 用 **(ii) inline 参数**先跑通;**(i) id+回调** + 完整白标（图片代理）一起放后面。
- 落地:按钮**只在 roller/drapery 结果**出现;落到该线**默认款**(卷帘→`rs-aria`,窗帘→`dp-velluto`,占位,以后会换)。

**phase-1 auth 技术决策（spec D1–D6,见 `docs/superpowers/specs/2026-06-14-quote-auth-phase1-design.md`）:**
- D4 会话用 cookie(`@supabase/ssr`),让服务端组件能读登录态。
- D5 关联**只存非机密标记**(`blindbot_linked_at` + `blindbot_email`),**不存 blind-bot 的 api_key**。
- D6 phase 1 **不强制任何页面登录**(后改为:只有 handoff 进来强制登录)。
- Google 用 `signInWithOAuth` 重定向流（不用 GSI 按钮流）。

**连调时我替你做的自主决策（你出门期间,你让我按推荐来）:**
1. **handoff 强制登录;普通浏览不强制**(保留原 demo)。
2. **"Continue with BlindBot" 暂不做**(需 blind-bot server 加对外身份接口 = phase 2);连调用 Google + 邮箱 + 自动邮箱关联。
3. 登录后**原样带回 handoff URL**(导入数据经 `next` 参数保留)。
4. **登录页全屏去 chrome**(路由分组 `app/(portal)/`),tab 标题改中性 "Trade Portal"。
5. **UI(子项目 4)**:导入时用带过来的真实图**替换** in-context SVG 渲染 + 打 "Carried over" 标签 + 隐藏位置滑杆;无导入时实时 SVG 照旧。
6. **卷帘定价两个版本**之前是同一份配置(bug),已拆成真实价差(2026.1: motorized 90/blackout×1.28；2026.2: 95/×1.30)。

---

## 3. 关键文件地图

**quote 仓库（本仓库）新增/改动:**
- 导入:`lib/import.ts`(`parseImportPayload` + `mapImportedConfig` no-op 接缝)
- 配置器:`components/Configurator.tsx`(导入时 carried-over 图 + 标签 + chips;接缝预填)、`app/(portal)/configure/[productId]/page.tsx`(解析参数 + **handoff 登录闸**)
- 认证:`lib/supabase/{client,server,middleware}.ts`、`middleware.ts`、`app/login/page.tsx`、`components/LoginForm.tsx`、`components/SignOutButton.tsx`、`app/auth/callback/route.ts`、`lib/auth/profile.ts`、`app/api/auth/sync/route.ts`
- 布局:`app/layout.tsx`(瘦身成 html/body)、`app/(portal)/layout.tsx`(侧边栏 chrome,所有 portal 页移入 `app/(portal)/`)
- 定价修复:`lib/catalog-data.ts`(新增 `ROLLER_PRICING_V2`)、`lib/db.ts`
- 文档:`docs/superpowers/specs/2026-06-14-result-to-configurator-import-skeleton-design.md`、`...quote-auth-phase1-design.md`、`THE-772-PROTOTYPE-GUIDE.*`、`THE-772-LEARNING-GUIDE.*`、本文件

**shared-ui 仓库改动:**
- `src/enterprise/components/ResultStep.tsx` —— 加了 `quoteLineFor` 分类器 + `buildQuoteUrl` + flag-gated 的 "Get a quote →" 按钮（提交在分支 `yanyan/the-772-quote-handoff-button`）

---

## 4. 环境与配置（⚠️ 换机器/换 session 必看）

### Supabase（quote 自己的项目）
- 项目:`blind-bot-quote-beta`,ref = **`ylcuuamsenvnqfnbhdmk`**,URL = `https://ylcuuamsenvnqfnbhdmk.supabase.co`
- 已建表:**`profiles`**(id→auth.users, email, full_name, company, blindbot_linked_at, blindbot_email, created_at + RLS 自有行读写)。建表 SQL 见 phase-1 spec 第 3 节。
- Auth:Google provider 已开(填了 Client ID + Secret);Email provider。**Site URL 应 = `http://localhost:3001`**。
- ⚠️ 若邮箱注册卡在 "confirm email":Supabase → Auth → Providers → Email → 关掉 **Confirm email**。

### Google OAuth（quote 品牌,白标关键）
- Google Cloud 项目 **"Quote"**;OAuth client(Web)Client ID = `469715934134-k2ss985tj4q7lvkkrr046sagg519cnp8.apps.googleusercontent.com`
- Authorized JS origin: `http://localhost:3001`;redirect URI: `https://ylcuuamsenvnqfnbhdmk.supabase.co/auth/v1/callback`
- ⚠️ consent screen 若是 Testing 状态,要把登录用的邮箱加进 **Audience → Test users**,否则 Google 会挡。

### `.env.local`（⚠️ gitignored,不在 git 里,换机器要重建）
```
NEXT_PUBLIC_SUPABASE_URL=https://ylcuuamsenvnqfnbhdmk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase → Settings → API → anon/public>
SUPABASE_SERVICE_ROLE_KEY=<Supabase → Settings → API → service_role（机密）>
NEXT_PUBLIC_GOOGLE_CLIENT_ID=469715934134-k2ss985tj4q7lvkkrr046sagg519cnp8.apps.googleusercontent.com
BLINDBOT_API_URL=https://blind-bot-server-bit-beta-fwig.onrender.com
```
> 两把 Supabase key 是机密,**没有进 git**。换机器时从 Supabase 控制台复制,或把本机 `.env.local` 安全拷过去。

---

## 5. 如何运行 + 测连调

```bash
npm install               # better-sqlite3 已移除,普通安装即可（无原生编译）
npm run dev -- -p 3001    # ⚠️ 必须 3001（Google origin / Supabase Site URL 都按 3001 配的）
```
> ⚠️ 数据层已迁到 Supabase/Postgres —— **必须有 `.env.local`**（含 Supabase URL + service_role key）才能跑,没有本地 SQLite 兜底了。

**测连调（模拟点了 blind-bot 按钮）**:打开
`http://localhost:3001/configure/rs-aria?line=roller-shade&img=https%3A%2F%2Fplacehold.co%2F640x480%2F2f5d50%2Ffff.png&cfg=%7B%22color%22%3A%22Emerald%22%2C%22translucency%22%3A%22Room%20Darkening%22%7D`
→ 应跳登录 → Google/邮箱登录 → 回配置器看到 "Carried over" 图。登录后去 Supabase `profiles` 看新行 + `blindbot_linked_at`（用 blind-bot 里存在的邮箱登才会关联）。

---

## 6. 已验证 vs 待真人验证
- ✅ 未登录 handoff → 307 跳 `/login?next=`(导入数据保留)
- ✅ 全 9 条路由 200;lint 零错误
- ✅ `profiles` 表可读写(service_role);blind-bot `/lookup-api-key` 可达
- ⏳ **交互式 Google/邮箱登录**(需真人点,自动化测不了)——这是回来要确认的第一件事

---

## 7. 下一步（建议优先级）

1. **真人跑一遍登录**,确认 profiles 建行 + 邮箱关联。
2. ✅ **已完成（1a + 1b）** —— quotes/orders/pricing 已迁到 Supabase/Postgres（`lib/db.ts` 走 service_role，better-sqlite3 已移除）;**1b** 也已完成:报价/订单按 `owner_id` 归属、零售商页面（Dashboard/Quotes/Pre-Orders）登录闸 + 只看自己的（+ 那 2 条公共示例 owner=null）、加入报价需登录、供应商后台仍看全部。**RLS 仍留作生产级兜底（未做）**;明细页 `/quotes/[id]`、`/orders/[id]` 暂未做逐条所有权校验。
3. **子项目 4 真实变体映射**:把 `mapImportedConfig` 从 no-op 升级为真实的产品/颜色/遮光/选项映射 + 自动预选(需先定"quote 产品是否与 blind-bot 对齐"的产品决策)。
4. **白标收尾**(任务 6):侧边栏/整体改名换 logo 换色、图片代理、(i) id 化 handoff。
5. **phase 2:"Continue with BlindBot"** —— blind-bot server 加对外"校验身份+返 profile"接口(可复用 `middleware/adminAuth.js` 的 JWT 校验);解决按钮命名与白标冲突。
6. **blind-bot 按钮上线**:shared-ui 那条改动要走你的 **yalc/发版** 流程进 `blind-bot-frontend`,并设 `NEXT_PUBLIC_QUOTE_HANDOFF_ENABLED=true` + `NEXT_PUBLIC_QUOTE_URL` 指向 quote 服务,真实安装器里才会出现按钮。
7. 确认 blind-bot 区分 roller/drapery 的真实字段(`product.subcategoryName` 取值),校准 `quoteLineFor`(目前按子串 "roller"/"drape" 粗匹配)。

---

## 8. 已知坑
- **GitHub 直连被墙**(这台机器):`github.com:443` 连不上;`ssh.github.com:443` 通、代理 `127.0.0.1:7897`(Clash Verge)通。git 推送需走代理或 SSH-over-443。
- **数据层已迁 Postgres**:better-sqlite3 已移除（缺 Python / 预编译二进制那个坑没了）。代价是 app 现在**必须有 Supabase env** 才能跑（数据层不像 auth 能优雅降级）。Supabase 里现有 6 张表:`profiles` + `pricing_versions`/`quotes`/`quote_items`/`orders`/`order_events`。
- **端口**:quote 服务必须 3001(blind-bot 占 3000);Next 16 一个项目只允许一个 dev server,换端口要先杀旧进程。
- **shared-ui** 是 GitHub tag + yalc 消费,改了源码要发版才会进 frontend。

---

## 9. 分支 / 仓库
- quote:`blind-bot-quoting`,**PR #1 已合入 `main`**(分支 `yanyan/the-772-import-skeleton` 仍在),remote `github.com/capricore/blind-bot-quoting`
- shared-ui:`blind-bot-shared-ui`,改动提交在分支 **`yanyan/the-772-quote-handoff-button`**,remote `github.com/c6wangya/blind-bot-shared-ui`
- 两份 spec 在 `docs/superpowers/specs/`;交付/教学文档 `THE-772-PROTOTYPE-GUIDE.*`、`THE-772-LEARNING-GUIDE.*`
