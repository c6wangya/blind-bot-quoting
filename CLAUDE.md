# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm install          # required first (also installs node_modules/next/dist/docs/, see AGENTS.md)
npm run dev -- -p 3001   # dev server — use port 3001 (Google OAuth / Supabase redirect URLs are configured for it)
npm run build        # production build
npm run lint         # eslint
```

There is **no test suite**. The data layer is **Supabase/Postgres** — the app needs `.env.local`
(see `.env.example` and `DEPLOY.md`); there is no local-file DB fallback. Demo data
(2 sample quotes/orders + pricing versions) is seeded into Supabase on first request when the
tables are empty. To reset, clear the rows (`node scripts/db-admin.mjs reseed`).

## What this is

A B2B quoting & pre-order portal for window treatments (Linear THE-772): catalog → configure →
auto-quote → pre-order → bilingual supplier Excel → status tracking to delivery. It is
white-labeled (default brand "Loom & Shade") and sits downstream of the **blind-bot** visualizer,
which hands off "Get a quote" designs. Real supplier/logistics integrations are simulated by the
admin-only Supplier Console (`app/(portal)/supplier`).

## Architecture

Next.js 16 App Router (no `src/` — `app/`, `components/`, `lib/` at root, imported via `@/`).
React 19, TypeScript, Tailwind v4 (tokens in `app/globals.css`, primitives in `components/ui.tsx`).
Routes live under the `app/(portal)/` group (sidebar layout); `app/login`, `app/handoff`, and
`app/api` are outside it.

**Data layer — Supabase/Postgres.** Two clients in `lib/supabase/`:
- `admin.ts` → `admin()` = service_role (bypasses RLS). Used for seed, ref-numbering, system
  reads (pricing), back-office (Supplier Console), and ownership-guard lookups.
- `server.ts` → `createClient()` = cookie/JWT client (subject to RLS). For retailer-facing
  reads/writes so the DB enforces ownership.

`lib/db.ts` is the single access layer: every retailer query helper takes an optional Supabase
client defaulting to `admin()`; retailer call sites pass `userClient()` (from `lib/auth/user.ts`)
so **RLS applies**. RLS policies live in `supabase/migrations/0001_rls.sql` (must be run once in
the Supabase SQL editor — see `DEPLOY.md`). Ownership: `quotes.owner_id` (NULL = public demo);
children inherit via the parent quote; admins (`profiles.role`) see all. App-layer guards
(`canAccessOwned`, `requireAdminPage` in `lib/auth/user.ts`) are kept as defense-in-depth.

**Catalog (static TS, real data).**
- `lib/catalog-data.ts` — full products (Roller Shade + Drapery), imported from blind-bot beta.
  Per-line opacity vocab + option groups; pricing configs.
- `lib/accessories-data.ts` — A-OK parts (motors/controls/power), imported from the 2025 pricing
  PDF. 3-level browse (brand → category → model) at `app/(portal)/catalog/accessories`. Motor
  categories are orderable; others reference-only.
- Real product photos live in `public/catalog/`; the `imageUrl`/category image is shown (the old
  programmatic SVG `components/renders.tsx` Swatch is only a small fallback).

**Pricing & quotes.** `lib/pricing.ts` — pure quote engine, kinds `roller-grid` and
`drapery-formula`; versioned `pricing_versions` rows; each quote line snapshots its `config` +
`computation` + version. Accessories are fixed-price quote lines (`lineId="accessory"`,
`AccessoryConfig`, see `isAccessoryConfig`), so they flow through the same pipeline. The client is
never trusted with prices — `POST /api/quote-items` re-prices server-side. Producibility is data
(`validOpacities` + `validateConfig`; `POST /api/price` returns 422 on non-producible combos).

**Order state machine:** `submitted → acknowledged → in_production → shipped → in_transit →
delivered`, via `POST /api/orders/:id/advance` (admin; 409 on out-of-order). Every transition
writes an `order_events` row — the retailer-facing update channel. `lib/excel.ts` builds the
bilingual (中文/EN) supplier workbook (`GET /api/orders/:id/excel`).

**Auth & blind-bot handoff.**
- Supabase auth: Google + email/password + the blind-bot handoff. `lib/auth/blindbot-handoff.ts`
  verifies a signed HMAC token (shared `QUOTE_HANDOFF_SECRET`) and provisions/links a quote
  account (`completeBlindbotHandoff`).
- Inbound "Get a quote" → `POST /api/handoff` (cross-site, so it can't read the session cookie):
  it verifies the token and 303s to the same-origin `app/handoff/choose`, which reads the session
  and decides — no session → `/login`; same email → first-time consent then silent
  (`user_metadata.bb_handoff_consented`); different email → account chooser.
- Reverse "Continue with BlindBot" (on `/login`) → bounces to blind-bot's `/authorize-quote`
  consent page → `GET /api/handoff/callback` completes the handoff.
- `lib/site-url.ts` `publicOrigin(req)` builds redirect origins from `x-forwarded-*` (behind a
  proxy like Render, `req.url` is the internal port).
- `lib/brand.ts` — white-label brand from `NEXT_PUBLIC_BRAND_*`.

`next.config.ts` marks `exceljs` as a `serverExternalPackage` (keep it out of client bundles).

## Conventions

- Route handler / page props are async: `params` and `searchParams` are `Promise`s — await them.
- Domain types are centralized in `lib/types.ts`; DB rows use snake_case→camelCase column aliases
  in `lib/db.ts` so everything above works with the camelCase domain types.
- Feature work follows a spec-first flow: design specs + plans under `docs/superpowers/`.
