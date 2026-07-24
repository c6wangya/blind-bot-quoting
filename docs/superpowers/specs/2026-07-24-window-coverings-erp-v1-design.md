# Window-Coverings ERP/CRM v1 — Product Templates, Merchant Customization, Pricing

**Date:** 2026-07-24
**Status:** Draft for review (Yan + Damon)
**Scope:** blind-bot-quoting repo. New finished-product system for custom window coverings (shades, blinds, shutters), built as a template + customization + pricing layer on top of the existing quote→order pipeline.

---

## 1. Goals

1. Support finished custom window-coverings products (roller, zebra, shutter first; more lines later) end-to-end: configure → validate → price → quote → order → documents → payment.
2. **Per-product-type default templates derived from blind-bot's 3D variation schemas.** Merchants (factories/wholesalers) customize on top: which variations/options they offer, option values, defaults, and prices.
3. **Schema alignment with blind-bot is a hard requirement.** Field keys and value tokens follow blind-bot's canon (render3d schema keys + EnumSpec canonical tokens) so the two platforms can be connected later without a translation layer. Where the anchor customer's Excel vocabulary differs in naming, ours wins; we map their data onto our tokens at import time.
4. Cover ≥90% of the most important functionality in the anchor customer's real order workbooks (11 analyzed Excel files): cascading option trees, W×H price grids by price group, width-banded option surcharges, flat add-ons, account discount factors, size limits per option, freight rules, order intake with one-row-per-window line items, document outputs.
5. Generalize beyond the anchor customer: onboarding company #2 should mean importing their catalogs/price books/rules — no code changes.

### Non-goals (v1)

- Production module (cut-sheet deductions, spring selection, BOM, QC, labels) — phase 2. The data model reserves room for it but v1 ships ordering + pricing.
- Full multi-tenant UI. v1 runs single-org (see §4), but all new tables carry `org_id` from day 1.
- Retail CRM (measure appointments, sales funnel) — phase 3.
- Inventory/material tracking.

---

## 2. Background (what exists)

### In this repo (blind-bot-quoting)
- Dormant window-treatments configurator (THE-772): `roller-shade` + `drapery` product lines as **static TS** (`lib/catalog-data.ts`, `lib/types.ts`), UI hidden (`Sidebar.tsx` Products `disabled: true`).
- Two pricing engines in `lib/pricing.ts`: `roller-grid` (W×H grid + multipliers + option surcharges) and `drapery-formula` — versioned via `pricing_versions`.
- Fully live: quotes/quote_items/orders/order_events pipeline, payments (Stripe/PayPal/transfer), partial refunds, supplier Excel + invoice + PO generators, Resend email, per-quote messaging, RLS ownership + admin acting-as.
- Accessory variation machinery (`variation_types`/`variation_items`/`variation_exclusion_groups`) — pattern reference, not reused directly.

### In blind-bot
- **`variationsJsonV2`** (2D canonical): object keyed by variation key; entries `{key, displayName, optionType, required, sortOrder, options[], customLabels}`; options `{value, label, hex, optionId, assetUrl, meta, isDisabled, isCustom, isDefault}`. **No dimensions, no prices.**
- **`variations_3d_json_v1`** (per-product 3D scheme): a curation/policy layer pinned to an immutable global schema revision. `fields: { [fieldKey]: FieldPolicy }` where FieldPolicy is a discriminated union on `controlKind` (`select|toggle|slider|color|image|text`), each with `isOffered` and kind-specific constraints (`allowedValues`, `range`, `allowedColors`, `allowedPatterns`, `defaultValue`). Validator: `blind-bot-server/src/contracts/catalog/product_3d_variations.js`.
- **Global 3D schemas** (`@blindbot/render3d`, table `render3d_variation_schemas`): per product line — `{productLine, schemaVersion, engine, sections[], defaults, variations: VariationDescriptor[], rules[]}`. Lines with schemas: `roller_shade`, `zebra_shade` (subcategory `banded_shade`), `plantation_shutter` (105 fields).
- **EnumSpec registry** (`blind-bot-server/src/domain/vocabulary/registry.js`): canonical tokens for ~40 window-covering axes (`installation: inside_mount|outside_mount|ceiling_mount`, `control_type`, `louver_size: 2_5_inch|…`, `frame_type`, `open_configuration`, `tilt_mechanism`, `header_style`, `cell_construction`, …).
- Product identity: `global_subcategories.key` (22 keys: `roller_shade`, `banded_shade`, `plantation_shutter`, `roman_shade`, `honeycomb_shade`, `drapery_panel`, `faux_wood_blind`, …).
- **blind-bot has no product pricing anywhere** — pricing is greenfield and owned by this platform.

### Anchor-customer domain (from the 11-workbook analysis, doc shared separately)
Uniform patterns across all their product lines:
- Order header: dealer, PO#, sidemark, ship-to, account discount factor.
- Line items: one row = one window (room, W, H in decimal inches, mount, product, fabric→color, control, motorization chain, special instructions). Parent/child lines for 2-on-1/3-on-1 multi-shade headrails.
- Pricing: `matrix(priceGroup, W, H)` rounded up to next break (N/A cell = unmanufacturable) + width-banded option surcharges + flat add-ons + special surcharges, × account factor (0.20–0.595 observed), + freight step (width > 93.875″ jumps $7→$95/unit), + tax.
- Validation: `(optionValue, dimension, min, max)` tuples + cross-option constraints.
- Documents: order acknowledgement, QuickBooks description text, labels, packing slip (v1: OA + QB text; rest phase 2).

### Competitor validation (QuoteRite, BlindMatrix, MyBlindCo)
All three converge on the same skeleton (product builder → option rules/validation → W×H supplier price grids + extras → quote → order → supplier PO → cut sheet). Table stakes for v1: catalog + price grids + option surcharges + discounts, config validation before order, quote→order zero re-entry, e-sign/payment on quote, QuickBooks integration, status tracking. Differentiators we uniquely have: 3D/AI visualization; differentiator to build: self-serve Excel price-book import (all three monetize catalog setup as a service — it is the industry's admitted pain point).

---

## 3. Design overview

Three layers, mirroring blind-bot's template→curation split:

```
┌────────────────────────────────────────────────────────────────┐
│ L1  Product templates (platform-owned, seeded from blind-bot)  │
│     one per product line; fields in render3d descriptor shape  │
│     = 3D schema fields (visual axes)                           │
│     + commercial extension fields (same shape, EnumSpec keys)  │
├────────────────────────────────────────────────────────────────┤
│ L2  Merchant products (org-owned customization)                │
│     catalog product → per-field policy (isOffered /            │
│     allowedValues / defaults)  — FieldPolicy shape ≡ 3D scheme │
├────────────────────────────────────────────────────────────────┤
│ L3  Commerce data (org-owned)                                  │
│     price grids · price-group maps · surcharge rules ·         │
│     size constraints · account factors · freight rules        │
└────────────────────────────────────────────────────────────────┘
                     ↓ consumed by
     configurator → validator → pricing engine → quote_items
              (existing quotes/orders pipeline unchanged)
```

**Key invariants**

- **I1 — Canonical naming:** every field key and enum value token in L1 comes from blind-bot (render3d field keys for visual axes; EnumSpec canonical tokens for extension axes and values). Display labels are separate and freely customizable per org (`customLabels` pattern). Customer-Excel vocabulary maps onto tokens at import; we never invent a parallel vocabulary.
- **I2 — Policy shape parity:** L2 per-field policy is structurally identical to blind-bot's `Product3dScheme` FieldPolicy (discriminated on `controlKind`, `isOffered`, kind-specific constraint). Future blind-bot↔quoting product sync = intersect on field keys, no translation.
- **I3 — Dimensions and prices live outside the variation document** (consistent with variationsJsonV2 semantics). Dimensions are template-declared line-item fields (stored as decimal inches, displayed as ⅛″ fractions); prices attach via L3 tables keyed by field/value tokens.
- **I4 — Snapshot discipline (existing repo rule):** quote lines snapshot full `config` + `computation`; templates/products/prices can change or be deleted without breaking history. Orders additionally pin `template_revision` and `pricing_version`.

---

## 4. Tenancy & roles (v1)

- New table `orgs` (id, name, kind `manufacturer|retailer`, settings jsonb). Seed one org = the anchor factory. All new tables carry `org_id NOT NULL`.
- v1 keeps the existing auth model: `admin` role = factory staff (catalog + pricing + order management), `retailer` role = the factory's dealers (configure/quote/order). `profiles` gains `org_id` (nullable; null = platform admin) and `account_id` → `dealer_accounts`.
- New `dealer_accounts` (id, org_id, company name, contact, default ship-tos, QuickBooks ref): the **dealer company** entity (multiple `profiles` may belong to one dealer_account). Account factors hang off this, not off individual users. This fixes the current repo gap where `profiles.company` is free text.
- RLS: same pattern as today (owner or admin), plus org scoping on catalog/pricing tables (public-read within org for retailers, admin-write).

---

## 5. Data model (new tables)

Migration numbering continues the repo sequence (0049+ at time of writing). All idempotent, snake_case columns, camelCase in DTOs (canonical API style: Bearer auth, camelCase, no nulls noise, no envelope). Primary keys are `bigint generated by default as identity` per repo convention (the `uuid pk` notations below are shorthand; the migration is authoritative).

### L1 — templates (platform-owned; org_id NULL = global)

```sql
product_templates (
  id uuid pk,
  line_key text not null,            -- global_subcategories.key: 'roller_shade' | 'banded_shade' | 'plantation_shutter' | ...
  revision int not null default 1,
  status text not null default 'draft',        -- draft | published | archived
  source jsonb,                      -- {render3dSchemaId, revision, fingerprint} when derived from blind-bot
  fields jsonb not null,             -- ordered TemplateField[] (see contract below)
  sections jsonb not null,           -- [{key,label}] card grouping, from render3d schema + commercial sections
  dimensions jsonb not null,         -- [{key:'width'|'height'|..., unit:'in', min, max, step, display:'fraction_8th'}]
  rules jsonb not null default '[]', -- cross-field visibility/write rules (render3d WriteRule subset)
  created_at, updated_at,
  unique (line_key, revision)
)
```

**TemplateField contract** (render3d `VariationDescriptor` superset):

```ts
type TemplateField = {
  key: string;                    // render3d key ('cassetteSize') or EnumSpec token ('control_type')
  label: string;                  // default display label
  section: string;
  control:
    | { kind: 'select'; options: { value: string|number; label: string }[] }
    | { kind: 'toggle' }
    | { kind: 'slider'; min: number; max: number; step: number }
    | { kind: 'color';  options: { value: string; label: string; hex: string }[] }
    | { kind: 'image' } // pattern/fabric swatch, org uploads assets
    | { kind: 'text' };
  defaultValue: unknown;
  required?: boolean;
  visibleWhen?: Condition[];      // render3d condition subset
  origin: '3d' | 'commercial';    // visual axis (exists in render3d) vs extension axis
  tier?: 'common' | 'advanced';
}
```

Seeding: for the 3 lines with 3D schemas, `fields` = render3d schema variations (minus `system: true` fields) ∪ commercial extension fields authored by us from the Excel analysis (motorization chain `motor_brand → motor_model → remote → remote_channel`, `charger`, `hub`, `valance/cassette type` where not visual, `side_channel`, `hold_down`, `reverse_roll`, etc.), all keyed with EnumSpec tokens. For lines without 3D schemas (roman, honeycomb, …), templates are authored in the same shape from EnumSpec axes — same contract, later arrival.

### L2 — merchant products

```sql
catalog_products (
  id uuid pk, org_id uuid not null,
  template_id uuid not null, template_revision int not null,   -- pinned
  name text not null, sku text, description text,
  status text not null default 'draft',      -- draft | active | archived
  field_policies jsonb not null,   -- { [fieldKey]: FieldPolicy }  — shape ≡ blind-bot Product3dScheme.fields
  image_url text, sort_order int,
  created_at, updated_at
)
```

**FieldPolicy** (verbatim from blind-bot contract, plus label overrides):

```ts
type FieldPolicy = { isOffered: boolean; labelOverride?: string } & (
  | { controlKind: 'select'; allowedValues: (string|number)[]; defaultValue: string|number;
      optionLabels?: Record<string,string> }
  | { controlKind: 'toggle'; defaultValue: boolean }
  | { controlKind: 'slider'; range: { min: number; max: number; step: number }; defaultValue: number }
  | { controlKind: 'color';  allowedColors: { optionId: string; label: string; value: string }[];  // #rrggbb lowercase
      defaultValue: string }
  | { controlKind: 'image';  allowedPatterns: { patternAssetId: string; label: string; assetUrl: string;
      priceGroup?: string }[]; defaultPattern: string|null }
  | { controlKind: 'text';   defaultValue: string }
);
```

Creating a product = pick template → policies initialized to "everything offered, template defaults" → merchant narrows/disables/re-labels and attaches prices. (Same UX as blind-bot's 3D variants editor — reuse its interaction design.)

### L3 — commerce data (all org-scoped, all effective-dated)

```sql
price_groups        (id, org_id, key, label)                       -- e.g. 'RSA', 'WWA', 'group_1'
price_group_maps    (id, org_id, product_id, field_key, value_token, price_group_id)
                    -- e.g. (fabricColor,'cream') → RSA ; (image pattern) → via priceGroup on allowedPatterns
price_grids         (id, org_id, price_group_id, currency,
                     width_breaks int[] , height_breaks int[],      -- ascending, inches
                     cells numeric[][],                             -- null cell = unmanufacturable
                     effective_from, effective_to, note)
surcharge_rules     (id, org_id, product_id null,                   -- null = org-wide
                     matcher jsonb,        -- {fieldKey, valueToken} or {fieldKey, anyOf[]}
                     kind text,            -- 'flat' | 'percent' | 'width_band' | 'per_linear_ft' | 'per_unit'
                     amount jsonb,         -- flat: {value} ; width_band: {breaks[], values[]} ; percent: {pct}
                     effective_from, effective_to)
size_constraints    (id, org_id, product_id null, matcher jsonb,    -- same matcher shape
                     dimension text,       -- 'width' | 'height' | 'area_sqft'
                     min numeric null, max numeric null, message text)
dealer_accounts     (id, org_id, name, contact jsonb, qb_ref text, created_at)
account_factors     (id, org_id, dealer_account_id, product_id null | line_key null,
                     factor numeric not null,                        -- dealer price = MSRP total × factor
                     effective_from, effective_to)
freight_rules       (id, org_id, method text, matcher jsonb, amount jsonb)  -- e.g. width>93.875 → 95/unit
```

Notes:
- Grid lookup = round **up** to the next break on both axes (matches customer Excel `MATCH(...,-1)` semantics); out-of-grid or null cell → 422 unmanufacturable.
- `area_sqft` constraint dimension covers rules like "over 64 sqft forces 2″ tube" — in v1 expressed as a hard size limit or surcharge; automatic component switching is phase-2 derivation.
- Everything effective-dated + `changed_by`/`note` (replaces the customer's hand-kept Log sheets).

### Quote/order integration

- `quote_items.line_id` gains `'window-product'`. `config` snapshot shape:
  `{ productId, templateRevision, room, widthIn, heightIn, mount, selections: Record<fieldKey, valueToken>, parentItemId?, specialInstructions }`
- `computation` snapshot: `{ msrpBase, surcharges[], addons[], factor, dealerUnit, freight, priceGroupKey, gridId, pricingVersion }` — full audit of the §6 formula.
- Parent/child grouping (2-on-1): child lines carry `parentItemId`, priced 0, validated as a group.
- Existing submit→pay→advance→refund machinery, Excel/invoice/PO/email generators extend to the new line kind (supplier Excel columns come from the config snapshot).

---

## 6. Pricing engine

One interpreter (`lib/pricing/window.ts`), no per-product code:

```
dealerLine =
  grid(priceGroup(selections), widthIn, heightIn)      // MSRP base, round-up breaks
  + Σ surcharge_rules matching selections               // flat | percent | width_band | per_linear_ft
  × accountFactor(dealer, product|line)
  + freight(method, widthIn)                            // order-level aggregation
```

- Price resolution endpoint: `POST /api/window/price` (re-uses the "server always re-prices, client price never trusted" rule; 422 with reasons on unmanufacturable/invalid).
- Validation pass runs first: field policy check (offered? allowed value?), `visibleWhen`-driven dependency check, size_constraints, grid cell existence. Errors are structured `{fieldKey?, code, message}` for inline UI display.

---

## 7. API surface (canonical style: Bearer/JWT, camelCase, no envelope)

Admin (factory):
- `GET/POST /api/window/templates` · `GET /api/window/templates/:id` (platform-seeded; org-visible)
- `GET/POST /api/window/products` · `GET/PATCH /api/window/products/:id` (PATCH merges field policies by key; write returns full DTO)
- `PUT /api/window/products/:id/prices` (grids/maps/surcharges bulk upsert) · `GET .../prices`
- `GET/POST/PATCH /api/window/dealer-accounts` + `/factors`
- `POST /api/window/import/price-book` (Excel importer — phase 1.5, the competitive differentiator)

Dealer:
- `GET /api/window/catalog` (offered products, resolved policies, display labels)
- `POST /api/window/price` (validate + price one line)
- existing `POST /api/quote-items` extended for `line_id='window-product'`

## 8. UI scope (v1)

1. **Un-hide Products nav**; product list = window catalog (per org).
2. **Admin: product editor** — template picker → per-section field policy editor (offer toggle, allowed values, defaults, label overrides) → pricing tab (price groups, grid editor with paste-from-Excel, surcharges, size limits). Interaction model copied from blind-bot's `ThreeDVariantsSection` (offer/narrow/default) — familiar to us and future-consistent.
3. **Dealer: configurator** — generalize `components/Configurator.tsx` to be template-driven (sections/cards from template, cascading via visibleWhen + policies, live price + inline validation errors, fraction input for W/H, room label, multi-line "add another window" flow).
4. **Admin: dealer accounts + factors** page.
5. Quote/order screens: minor — render window-product line summaries (already snapshot-driven).

## 9. Rollout

| Phase | Contents |
|---|---|
| **A (this)** | Spec review → migrations (orgs, dealer_accounts, L1/L2/L3 tables) → template seeds for roller_shade / banded_shade / plantation_shutter (render3d schema export + commercial extension fields) → pricing engine + validation + price API → admin product editor → dealer configurator → quote/order line integration → OA/QB-text document output |
| **A.5** | Excel price-book importer (grids, fabric→group maps, surcharge tables) — unlocks anchor-customer onboarding without manual re-keying |
| **B** | Production module: deduction tables, derived cut sheets, labels, packing slip, QC — shadow-run against customer's Excel outputs |
| **C** | Retail CRM (measure/funnel/install), multi-org UI, QuoterRite-style dealer network |

## 10. Open questions (for Damon)

1. Template seed source: export render3d global schemas via `GET /installer/variation-schema` from beta, or import from the npm package at build time? (Proposal: one-shot export script into `data/templates/*.json`, checked in; re-sync manually on schema bumps — keeps quoting deployable without blind-bot at runtime.)
2. Do we want `field_policies` to also round-trip INTO blind-bot later (quoting as the editor of record for 3D offering), or one-way blind-bot→quoting for v1? (Proposal: one-way v1.)
3. Account factor granularity: per (dealer × line) matches the anchor customer's Excel (0.282 cellular vs 0.55 aluminum); per (dealer × product) as override — both supported by the table; confirm UI exposes line-level first.
4. Currency/tax: v1 USD-only, tax as flat order-level percent (their CA model), or pluggable from day 1?
5. Keep `pricing_versions` mechanism for the new engine, or fold versioning into the effective-dated L3 tables? (Proposal: L3 effective-dating replaces it for window products; `pricing_versions` stays for legacy lines.)

## 11. Excel-coverage checklist (anchor customer, v1 target ≥90%)

| Capability in their workbooks | v1 |
|---|---|
| Cascading option trees (INDIRECT) | ✅ policies + visibleWhen |
| Fabric→price-group→W×H grid MSRP, round-up, N/A cells | ✅ price_groups/maps/grids |
| Width-banded option surcharges (cordless, TDBU…) | ✅ surcharge_rules width_band |
| Flat add-ons (motor/remote/hub/charger) | ✅ surcharge_rules flat/per_unit |
| Special surcharges (narrow width, French-door cutout, % rules) | ✅ percent/flat with matchers |
| Account discount factor per dealer per line | ✅ account_factors |
| Size limits per option (+ motor min-widths) | ✅ size_constraints |
| Freight step by width + will-call | ✅ freight_rules (+ existing shipping) |
| One-row-per-window intake, room labels, sidemark, PO# | ✅ existing quotes + new config shape |
| 2-on-1 / 3-on-1 parent-child lines | ✅ parentItemId, child priced 0 |
| Order acknowledgement + QuickBooks description text | ✅ extend existing generators |
| Email intake replacement (portal submit) | ✅ existing submit flow |
| Deposit/balance, payments, refunds | ✅ existing |
| Cut sheets / deductions / BOM / labels / packing | ⏭ phase B |
| Measure form / retail CRM | ⏭ phase C |

Detailed workbook analysis: shared artifact (EN/CN), available on request; per-file structural dumps archived.
