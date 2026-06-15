# White-label the quote service — "Loom & Shade"

**Ticket:** THE-772 (sub-project 6) · **Date:** 2026-06-15

## Problem

The quote service is internally linked to BlindBot, but retailers must perceive it as
an independent company — a hard requirement of THE-772. Today several retailer-facing
surfaces carry the "BlindBots / Trade Portal" identity, and the result image carried
over from the installer is loaded directly from a blind-bot URL, exposing the origin in
the browser's network panel.

This sub-project removes the retailer-visible BlindBot identity behind a configurable
brand. It deliberately keeps the *internal* link (the blind-bot API calls, the
`blindbot_linked_at` stamp, code comments) — that is how the two systems cooperate and
is never shown to a retailer.

## Decisions (locked)

- **Brand:** `Loom & Shade`, tagline `Trade Portal`, monogram `LS`. Env-configurable;
  these are only the defaults.
- **Result image:** proxy it through the quote service so the network origin is hidden.
- **Supplier Excel:** rebrand it too (retailers can download it from the order page).
- **Inbound handoff URL leak:** accepted as a known limitation this round (see below).

## Design

### 1. Brand config — single source of truth

`lib/brand.ts`:

```ts
export const BRAND = {
  name:     process.env.NEXT_PUBLIC_BRAND_NAME     ?? "Loom & Shade",
  tagline:  process.env.NEXT_PUBLIC_BRAND_TAGLINE  ?? "Trade Portal",
  monogram: process.env.NEXT_PUBLIC_BRAND_MONOGRAM ?? "LS",
};
```

`NEXT_PUBLIC_*` so the same vars resolve in both client components (Sidebar, LoginForm)
and server contexts (layout metadata, Excel). Add the three vars (commented, with the
defaults) to `.env.local` and `.env.example`. Swapping the brand for another deploy is
an env change, no code edit.

### 2. Apply the brand to the four retailer-facing surfaces

- **`components/Sidebar.tsx`** — the brass logo square shows `BRAND.monogram` instead of
  `B`; the wordmark shows `BRAND.name`; the sub-label shows `BRAND.tagline`.
- **`components/LoginForm.tsx`** — the two `Trade Portal` headings show `BRAND.name`
  (with `BRAND.tagline` as the secondary line).
- **`app/layout.tsx`** — `metadata.title` becomes `{ default: BRAND.name, template:
  `%s · ${BRAND.name}` }`.
- **`lib/excel.ts`** — `wb.creator`, the sheet title cell, and the footer note use
  `BRAND.name`; the filename uses a slug of the name
  (e.g. `${order.ref}_LoomAndShade_PreOrder.xlsx`).

The visual palette (navy + brass) is unchanged — it is neutral, not a BlindBot mark.

### 3. Image proxy — `app/api/img/route.ts`

`GET /api/img?src=<url-encoded absolute url>`:

1. Reject if `src` is missing, not an http(s) URL, or its hostname is not in an
   allowlist. The allowlist comes from env `IMG_PROXY_ALLOWED_HOSTS` (comma-separated),
   defaulting to the hostname of `BLINDBOT_API_URL`. This prevents the route from being
   an open proxy / SSRF vector.
2. Fetch the upstream image server-side, stream the body back with the upstream
   `content-type` and a cache header (`public, max-age=3600`).
3. On a disallowed/invalid `src`, return 400; on upstream failure, return 502.

Consumer changes:

- **`components/Configurator.tsx`** — the carried-over result `<img>` (B-layout) uses
  `/api/img?src=${encodeURIComponent(img)}` instead of the raw blind-bot URL, so the
  browser's network panel only shows the Loom & Shade origin.
- After the configurator has read the import params on mount, it strips
  `img` / `cfg` / `line` from the address bar via `history.replaceState`, so the
  blind-bot URL does not linger in the visible URL or browser history.

### 4. Out of scope

- Internal, non-retailer-visible references: code comments in `lib/import.ts` and
  `lib/auth/profile.ts`, the blind-bot API integration itself, and the
  `blindbot_linked_at` / `blindbot_email` columns. These are the deliberate internal
  link and stay.
- **Inbound handoff URL:** when a retailer first lands on the configurator, the
  blind-bot image URL is still present as a query param for the moment before the
  strip runs. Fully eliminating that requires changing the handoff so blind-bot sends an
  opaque token the quote service resolves server-side — a separate sub-project that
  touches the blind-bot side. Within the quote service, the proxy + URL-strip close the
  casual-inspection leak; this residual is accepted for now.

## Verification

- `grep -ri "blindbot\|trade portal"` over `app/ components/ lib/` returns only
  `lib/brand.ts` defaults and the intentionally-kept internal references (comments,
  API calls, db column names) — no retailer-facing hardcodes.
- Manual: sidebar wordmark, login heading, and browser tab title all read
  "Loom & Shade"; downloading the pre-order Excel shows the brand in the document and
  the filename; DevTools → Network on the configure page shows the result image request
  going to `/api/img` on the quote origin, not to blind-bot.
- `npm run lint` and `npx tsc --noEmit` clean.
