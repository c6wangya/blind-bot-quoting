# Continue-with-BlindBot — reverse SSO (login-initiated, with consent)

**Ticket:** THE-772 (sub-project: phase 2b) · **Date:** 2026-06-16
**Branch:** `yanyan/the-772-continue-with-blindbot-reverse`

## Why

The inbound handoff ("Get a quote" on blind-bot → quote) **silently provisions** a quote
account and drops the user straight into the configurator — making two separate services
feel like one, with no consent. This adds the *reverse*, user-initiated path: a
**"Continue with BlindBot"** button on the quote login page, so quote behaves like its own
service offering BlindBot as a sign-in method (à la "Sign in with Google") — an explicit,
consented choice.

## Flow

```
quote /login  →  [Continue with BlindBot]
  → browser to  {BLINDBOT_FRONTEND}/authorize-quote?redirect_uri={quote}/api/handoff/callback&next=/&brand=Loom%20%26%20Shade
      authorize-quote (blind-bot-frontend):
        - not logged in → blind-bot login, return to /authorize-quote (params preserved)
        - logged in → CONSENT screen: "Continue to <brand> as <email>?"  [Continue] [Cancel]
        - Continue → POST {API_URL}/quote-handoff-token (Bearer access_token) → narrow token
                   → redirect to  redirect_uri?token=<t>&next=<next>   (redirect_uri allowlisted)
  → quote GET /api/handoff/callback?token=&next=
        verify token (existing completeBlindbotHandoff) → provision + session
        → 303 to next (or /login?error on failure)
```

Reuses the **existing** `/quote-handoff-token` (already on beta) and the existing
HMAC verify (`completeBlindbotHandoff`). **No blind-bot-server change.**

## Changes by repo

### quote (`blind-bot-quoting`)
- `components/LoginForm.tsx`: add a **"Continue with BlindBot"** button. Builds the
  authorize URL from `NEXT_PUBLIC_BLINDBOT_FRONTEND_URL`, passing
  `redirect_uri = {origin}/api/handoff/callback`, `next` (the safe dest), and
  `brand = BRAND.name`. Hidden if `NEXT_PUBLIC_BLINDBOT_FRONTEND_URL` is unset.
- `app/api/handoff/callback/route.ts` (**new, GET**): read `token` + `next` (internal-only),
  `completeBlindbotHandoff(token)` → 303 to `next` on success, `303 /login?error=handoff`
  on failure. Mirrors the POST `/api/handoff`, but token arrives via query (browser redirect).
- `.env.local` / `.env.example`: add `NEXT_PUBLIC_BLINDBOT_FRONTEND_URL` (local
  `http://localhost:3000`).

### blind-bot-frontend
- New route `app/(public)/authorize-quote/page.tsx` (client): Supabase session →
  if absent, send to blind-bot login with a return to this URL; if present, render the
  consent card and, on Continue, mint via `POST {NEXT_PUBLIC_API_URL}/quote-handoff-token`
  and `window.location.assign(redirect_uri?token=&next=)`.
- **Security — redirect_uri allowlist:** only honor a `redirect_uri` whose origin equals
  `NEXT_PUBLIC_QUOTE_URL` (already configured). Anything else → show an error, never mint.
  This is what stops the signed token from being exfiltrated to an attacker origin.

## Security

- **redirect_uri allowlist** (origin === `NEXT_PUBLIC_QUOTE_URL`) prevents open-redirect /
  token theft — the single most important control here.
- Token is the same narrow, 5-min HMAC email token; useless against blind-bot, and consumed
  immediately by the quote callback (a 303, never rendered into a page).
- `next` is validated internal-only (`/`-prefixed, not `//`) on both the button and callback.
- `brand` is display-only; escape it; never use it for routing.
- Raw blind-bot `access_token` never leaves blind-bot's own origin (only POSTed to its API).

## Verification

- **Quote (self-contained):** GET `/api/handoff/callback?token=<locally-minted>` → 303 into
  the dest with a session cookie; tampered/expired token → `303 /login?error=handoff`.
- **blind-bot authorize:** logged in → consent card shows email + brand; Continue mints and
  redirects only to the allowlisted quote origin; a foreign `redirect_uri` → blocked.
- **End-to-end (local, both dev servers on beta env):** quote `/login` → Continue with
  BlindBot → (login if needed) → consent → back at quote, authenticated, on `next`.
- `npm run lint` + `tsc --noEmit` clean (quote).

## Out of scope / later
- Production: set `NEXT_PUBLIC_BLINDBOT_FRONTEND_URL` (quote) to the real blind-bot domain;
  ensure `NEXT_PUBLIC_QUOTE_URL` (blind-bot) points at the real quote domain.
- The inbound "Get a quote" flow is unchanged here; it could later route through the same
  consent screen for symmetry.
- A `state`/PKCE nonce (CSRF) — low risk given the redirect_uri allowlist + short-lived
  token; can add if this graduates beyond prototype.
