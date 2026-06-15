# 子项目 4 续 — 真实变体映射（设计）

> 日期：2026-06-15 · 分支：`yanyan/the-772-variation-mapping`
> 前置：skeleton 已把 blind-bot 的 result 图 + 选配（`cfg`）带到配置器；`mapImportedConfig` 此前是 no-op。本轮把它升级为真实映射。

## 目标
导入时,把 blind-bot 的选配**尽力**预选进 quote 配置器表单,**始终尊重产品约束**;映射不上的留默认。

## 依据（blind-bot 真实取值，来自 server/shared-ui 代码）
- translucency/transparency:`Sheer`、`Solar`、`Semi-Sheer`、`Light Filtering`、`Privacy`、`Room Darkening`、`Blackout`（`transparencyOptions` 示例 `["Sheer","Light Filtering","Privacy","Blackout"]`）。
- mountType:`Inside Mount` / `Outside Mount`。
- control:`Motorized`、`Cordless`、`Continuous Cord` 等。
- color:自由命名(与 quote 色板基本不同)。

## 映射规则（`lib/import.ts` 的 `mapImportedConfig(cfg, product, line)`）
| quote 字段 | 来源 | 规则 | 兜底 |
|---|---|---|---|
| `opacityId` | `translucency` | Blackout→blackout;Room/Darken→room-darkening;Filter/Privacy→light-filtering;Sheer/Solar/Screen→sheer | **仅当 ∈ `product.validOpacities`**,否则不设 |
| `colorId` | `color` | 与产品色板**名字忽略大小写精确匹配** | 不匹配则不设(多半) |
| `options.mount`(卷帘) | `mountType` | Inside→inside;Outside→outside | 该 option 存在才设 |
| `options.control`(卷帘) | `control` | Motorized→motorized;cord/chain→chain-plastic | 同上 |
| `dimensions` | —— | blind-bot 无尺寸 | 留给用户填 |

所有 option 值都经 `line.optionGroups` 校验存在才套用 → 卷帘专属选项不会套到窗帘;不可生产的遮光度不会硬塞。

## 配置器接入
`Configurator` 已有的 prefill 接缝:`const prefill = mapImportedConfig(cfg, product, line)` → 用 `prefill.{opacityId,colorId,options,dimensions}` 初始化表单。映射上的字段自动预选,其余默认。"导入的设计"参考卡(图片 + 原始 chips)照旧显示。

## 验收
- 单元测试(`node --experimental-strip-types`):rs-aria + Room Darkening/Outside/Motorized → `{opacityId:room-darkening, options:{mount:outside,control:motorized}}`;rs-aria + Sheer → `{}`(约束拦截);rs-solar + Solar → `{opacityId:sheer}`;dp-velluto + Blackout/Inside/Motorized → `{opacityId:blackout}`(窗帘不套卷帘选项)。全过。
- lint + tsc 干净。
- 端到端(登录态)：开 handoff URL → 配置器表单按上述预选 + 显示 carried-over 图。

## 推迟
- **产品对齐**:仍落在产品线默认款(rs-aria/dp-velluto),不按 blind-bot 产品映射到具体 quote 产品。
- color 的近似匹配(同义/近色)、lighting/valance/texture/hemStyle 等字段映射、尺寸推断。
- 把"哪些字段成功映射 / 哪些没映射"显式提示给用户(目前靠 carried-over chips + 预选表单体现)。
