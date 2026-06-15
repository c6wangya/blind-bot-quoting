# 子项目 3 · 1b — 报价/订单归属到登录用户（设计）

> 日期：2026-06-15 · 分支：`yanyan/the-772-quote-ownership`
> 前置：1a（数据层已在 Supabase/Postgres，`quotes` 已有 nullable `owner_id` 列）。

## 1. 目标
让每个零售商**只看到自己的**报价/订单；新建的报价/订单写入 `owner_id = 当前登录用户`；零售商页面需登录；供应商后台仍看全部。

## 2. 已确认的决策
- **① demo 那 2 条种子单 `owner_id` 留空 → 当公共示例**：零售商列表过滤用 `owner_id = me OR owner_id IS NULL`，所以人人都能看到这 2 条示例 + 各自的。
- **② 继续用 service_role + 在代码里按 owner 过滤**（不切 RLS）。原因：Supplier Console 是后台（看全部）、seed 需提权，纯 RLS 会和它们打架。RLS 留作以后生产级兜底。
- **③ 零售商页面要登录**（Dashboard / Quotes / Pre-Orders / 加入报价）；**Catalog / Configure 匿名可访问**（浏览+定价）；Supplier Console / Pricing 后台本轮维持开放（标注以后加管理员权限）。

## 3. 改动

### 3.1 当前用户辅助 `lib/auth/user.ts`（新增）
- `getCurrentUserId(): Promise<string|null>` —— 从 server Supabase 会话取 `user.id`（= `profiles.id` = `owner_id`）。无会话/无 Supabase → null。
- `requireUserId(next: string): Promise<string>` —— 没登录就 `redirect('/login?next=' + next)`。

### 3.2 数据层 `lib/db.ts`（加 owner 过滤）
- `getDraftQuote(ownerId)` / `getOrCreateDraftQuote(ownerId, projectName?)` —— 草稿按 owner 取/建；建时写 `owner_id`。
- `getQuotes(ownerId)` —— `owner_id = ownerId OR owner_id IS NULL`。
- `getOrders(ownerId?)` —— 传 ownerId 则按 `owner_id = ownerId OR null` 过滤（join quotes 的 owner，JS 端过滤）；**不传 = 全部**（Supplier Console 用）。
- `getRecentEvents(limit, ownerId?)` —— 传 ownerId 则只取 owner-or-null 订单的事件。
- **不动**（按 id 取，后台也用）：`getQuote(id)`、`getOrder(id)`、`getOrderRefByQuote`、`submitPreOrder`、`updateOrder`、`addQuoteItem`、`removeQuoteItem`。

### 3.3 零售商页面（登录闸 + 传 ownerId）
- `/`（Dashboard）：`const ownerId = await requireUserId("/")` → `getQuotes/getOrders/getRecentEvents(ownerId)`。
- `/quotes`：`requireUserId("/quotes")` → `getQuotes(ownerId)`。
- `/orders`：`requireUserId("/orders")` → `getOrders(ownerId)`。
- `(portal)/layout.tsx`：draftCount 改为「有登录用户才按其 owner 取草稿，否则 0」（layout 也包着匿名可访问的 catalog/supplier，所以要容忍无用户）。

### 3.4 加入报价需登录
- `POST /api/quote-items`：服务端取当前 user，**无 → 401**；有 → `getOrCreateDraftQuote(userId)`。`DELETE` 同样要登录。
- `components/Configurator.tsx`：`addToQuote` 收到 **401** → `window.location = /login?next=<当前 configure URL>`。

### 3.5 不动
- Supplier Console：`getOrders()` 不传 ownerId → 看全部（后台）。
- Catalog / Configure：匿名可访问（仅"加入报价"需登录）。

## 4. 验收
1. 登录用户 A 在 Dashboard/Quotes/Pre-Orders 看到 **A 自己的 + 2 条公共示例**；A 新建的报价带 `owner_id = A`。
2. 换个用户 B 登录：看到 **B 自己的 + 同样 2 条示例**，看不到 A 私有的。
3. 未登录访问 `/`、`/quotes`、`/orders` → 跳 `/login?next=...`。
4. 未登录在 configure 点"加入报价" → 跳登录（带 next 回来）。
5. Supplier Console 仍看到所有订单（含 A、B、示例）。
6. lint + tsc 干净；handoff 流程、Postgres 数据层不受影响。

## 5. 明确推迟（本轮不做）
- **明细页 `/quotes/[id]`、`/orders/[id]` 的逐条所有权校验**（本轮只过滤列表页；明细页按 id 可达，知道链接即可看）。生产级要加。
- `removeQuoteItem`/`submitPreOrder` 的按 owner 鉴权。
- 数据库层 **RLS**。
- Supplier Console / Pricing 的管理员鉴权。
