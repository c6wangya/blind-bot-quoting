# 真实产品目录 — 从 blind-bot beta 拉取（设计）

> 日期：2026-06-16 · 分支：`yanyan/the-772-real-catalog`
> 背景：目录此前是 `lib/catalog-data.ts` 里 12 个**编造**的占位产品（rs-aria/dp-velluto…）+ 程序化 SVG 渲染。本轮把 THE-772 v1 的两条线（Roller Shade / Drapery）换成 blind-bot beta 的**真实数据**。

## 数据来源（已拉取并快照存档）
- beta API：`https://blind-bot-server-bit-beta-fwig.onrender.com`，用 `BLINDBOT_TEST_API_KEY`（只读）。
- 子类：`roller_shade`(id 1) / `drapery_panel`(id 17)。
- 真实产品：`Roller Shade`(beta id 877) / `Standard Drapery`(beta id 873)，均 `active`、`template` 模式。
- 快照存 `docs/blind-bot-beta-snapshot/`（schema + product JSON + clean-catalog + image-manifest）。
- 实拍图下载到 `public/catalog/{roller-shade,drapery}/`（roller 6 张 / drapery 5 张），`00.jpg` 为主图。

**决策（用户已确认）**：① 选项词汇取**子类 schema**（更干净全，带 hex / 9 色 rod_color），产品名+图取真实产品；② 配置器渲染**改用真实产品图**取代 SVG。

## 上游没有、由 quote 侧提供
blind-bot 只有视觉变体，**无价格 / tier / 真实 SKU / 尺寸**。这些继续由 quote 侧定义：tier（standard/premium/designer）、SKU、定价配置、尺寸字段，沿用既有定价引擎。

## 清洗规则
丢弃：`meta.under_testing` 标记项、测试垃圾（newinstalleroption / Tiger / Red Tiger / Tribal / Checkerboard / debug / test* / 随机串）、开孔率纯百分比项（`15%`…`0.0%`，属 solar 开孔系数，与分类式 opacity 无关）、近重复（drapery `ripple` vs `ripplefold`）。

## 选项 → 定价键 映射
**opacity 改为按线定义**（`OpacityId` 放宽为 string；每条 `ProductLine` 带 `opacities`，每个 `Product` 带 `validOpacities`）：
- 卷帘 transparency → `sheer / light-filtering / privacy / blackout`
- 窗帘 transparency → `sheer / semi-sheer / opaque / blackout`

| 线 | quote optionGroup | blind-bot 源 | 取值（清洗后） |
|---|---|---|---|
| 卷帘 | `mount` | installation | inside / outside / ceiling |
| 卷帘 | `control` | control_type | manual / cordless / motorized |
| 卷帘 | `headrail` | top_treatment_style | white/black/brown/grey-cassette · valance · open-roll · fascia |
| 卷帘 | `sideChannel` | side_channel | none / black / white / brown |
| 窗帘 | `control` | control_type | motorized-somfy / baton-draw / cord-draw |
| 窗帘 | `liner` | liner | unlined / privacy / blackout / interlined |
| 窗帘 | `fullness` | fullness | 2x / 2.5x / 3x |
| 窗帘 | `header` | header_style | pinch/euro/goblet-pleat · ripplefold · grommet · rod-pocket · back-tab |
| 窗帘 | `rodColor` | rod_color | 9 色带 hex |
| 窗帘 | `stack` | stack_direction | left / right / split |

颜色：卷帘 white/cream/tan/gray/charcoal（带 hex）；窗帘 white/grey（beta 仅此 2 色，稀疏属实）。

定价配置 (`ROLLER_PRICING_*` / `DRAPERY_PRICING_V1`) 的 `opacityMultiplier`/`optionSurcharges`/`makingPerWidth`/`liningPerMeter`/`controlFlat`/`fullnessFactor` 全部改键以对齐上表。`fullnessFactor`: 2x→2.0 / 2.5x→2.5 / 3x→3.0。

## 渲染
- `Product` 新增 `imageUrl`(主图) + `galleryImages[]`，指向本地 `public/catalog/...`（自包含，不依赖运行时代理）。
- 配置器主区与目录卡用真实图；颜色仍以色板小圆点呈现（无逐色实拍图，故选色不换主图——用户已接受）。
- handoff 带入的 carried-over 图逻辑不变（仍走 `/api/img` 代理）。
- 保留 `patternStyle`(可选) 仅供 `Swatch` 兜底。

## 重置种子
demo 种子（`lib/db.ts`）引用旧产品 id（rs-aria…）。改为引用新产品 id；并 truncate `pricing_versions/quotes/quote_items/orders/order_events` 让种子按新配置重灌（提供一次性 `scripts/reseed` 或直接清表）。

## 验收
- `npm run build` + lint 干净。
- 目录页显示 2 个真实产品（实拍图、真实选项），配置器选项来自清洗后的 schema，自动报价仍工作（422 仍拦不可生产组合）。
- 报价→预订单→Excel 全链路用新产品跑通；Excel 选项标签为新键的显示名。
- 截图核对目录 / 配置器 / 报价单。

## 推迟 / 已知限制
- beta 真实目录稀疏（每线 1 产品、窗帘仅 2 色）——真实 SKU 扩充待业务方供清单后再导入。
- 逐色/逐变体实拍图（上游无）；选色不换主图。
- import.ts 的 opacity 映射键随之更新（room-darkening 等旧键 → 新的按线键）。
