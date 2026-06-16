# Accessories catalog (A-OK parts) — design

**Ticket:** THE-772 (Damon request) · **Date:** 2026-06-16
**Branch:** `yanyan/the-772-accessories`

## Why

The Catalog gets two sub-sections:
- **Catalog · Products** — the existing full products (roller shade / drapery), reached from the
  "Get a quote" handoff.
- **Catalog · Accessories** — NEW. A 3-level browse of A-OK parts. **Motors** are the launch
  product customers can actually order; controls/power are reference for now.

## Data source

Imported from `2025 Business pricing.pdf` (A-OK, 49 line items → `lib/accessories-data.ts`),
prices verbatim. Category taxonomy follows A-OK's own distributor site
(aplusmanufactory.com): Roller Shades / Curtain / Venetian / Roller Shutter Motors,
Remote Control, Receivers, Power & Accessories, Smart Central Control.

**For the Damon/website review (later):** the motor→category mapping is best-effort from the
PDF descriptions (AM20 placement flagged); models on the website but not the PDF (AM70,
AC139-01, AC407-01) are deferred; images are category-representative (from the PDF) until
per-model photos are pulled from the site.

## 3-level structure (L1 → L2 → L3)

Brand (A-OK) → Category → Model (image, name, SKU, price, description). Master-detail UI
at `app/(portal)/catalog/accessories/page.tsx`, category selected via `?cat=`.

- Motor categories are `orderable: true` → each model shows a qty stepper + **Add to quote**.
- Control/power categories are `orderable: false` → shown as **Reference** (price + spec, no
  order button). Trivially flipped on later by setting `orderable: true`.

## Ordering — reuses the quote pipeline

A motor is a `quote_items` row like a full product, so it flows through the same
quote → pre-order → supplier Excel → tracking pipeline (retailers can order shades + motors
together). Differences:
- `lineId = "accessory"`, `config` = `AccessoryConfig` `{ kind, sku, name, brand, category }`
  (no dimensions/options), `computation` = fixed price from the PDF (`pricingVersion = aok-2025`).
- `POST /api/quote-items` detects an accessory `productId`, verifies its category is orderable,
  and calls `addAccessoryItem` (RLS-scoped user client, same as full products).
- Render paths (quote detail, order detail, Excel) branch on `isAccessoryConfig` to show the
  accessory row (image, name, SKU, qty × price) instead of color/dimensions.

## Verification

- `npm run build` + tsc clean.
- Accessories page renders the 3-level browse; category switching works; motors show
  Add-to-quote, non-motors show Reference.
- E2E (Playwright, throwaway account): login → Accessories → Add to quote on a motor →
  the motor appears as a quote line (A-OK · Roller Shades Motors · AM15-03/35-ES-E, $31, qty)
  with a working Submit pre-order. Cleaned up after.

## Out of scope / later (the website review with Damon)
- Per-model photos + any catalog corrections from aplusmanufactory.com.
- New website-only models (AM70, AC139-01, AC407-01).
- Making controls/power orderable.
