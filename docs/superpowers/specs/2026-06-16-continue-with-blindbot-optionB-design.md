# Continue-with-BlindBot — Option B (signed handoff token)

**Ticket:** THE-772 (sub-project 8, revised) · **Date:** 2026-06-16

## Why this revises the earlier design

The first verified-handoff design (Option A) had blind-bot POST the retailer's **raw
Supabase `access_token`** to the quote service, which validated it via blind-bot's
Supabase. That works, but it hands a broad bearer credential (able to act as the user on
blind-bot until it expires) to a second service. To avoid quote ever seeing that broad
token, Option B has **blind-bot mint a narrow, purpose-built token** that only carries
the email and is verifiable by quote with a shared secret.

The shared-ui plumbing from v0.1.174 (`quoteAuthToken` forwarded into `ResultStep`) is
**reused unchanged** — Option B only changes *what* token the frontend puts in it.

## Mechanism

```
blind-bot user clicks "Get a quote"
  → frontend calls blind-bot-server POST /quote-handoff-token  (Authorization: Bearer <supabase access_token>)
       server verifies the access_token (supabase.auth.getUser) → email
       server returns a narrow token:  base64url({email, exp}) + "." + HMAC_SHA256(payload, SECRET)
  → frontend puts that narrow token in quoteAuthToken
  → ResultStep POSTs it to quote POST /api/handoff
       quote verifies the HMAC with the same SECRET, checks exp, extracts email
       → provision + mint quote session → redirect into configurator
```

The raw `access_token` only ever travels to **blind-bot's own backend**. Quote only ever
sees the narrow token (email + short expiry, useless against blind-bot).

## Shared secret

`QUOTE_HANDOFF_SECRET` — a high-entropy string set identically on **both**
blind-bot-server and the quote service. Local `.env` on both; **production: set on both
Render services** (the operator's step — same model as the existing
`PROVISION_TECH_SECRET`). When unset on either side, the handoff degrades to manual login
(quote) / the endpoint 503s (server).

## Token format

`"<payload>.<sig>"` where
- `payload = base64url(JSON.stringify({ email, exp }))`, `exp` = unix seconds, now + 300.
- `sig = base64url(HMAC_SHA256(payload, QUOTE_HANDOFF_SECRET))`.

Verification recomputes the HMAC over `payload`, compares constant-time, then checks
`exp` is in the future and `email` is present. No JWT library — Node `crypto` on both
sides.

## Changes by repo

### blind-bot-server (additive — no existing logic touched)
- In `setupAuthRoutes(app, supabase)` (`routes/auth_init.js`), add `POST
  /quote-handoff-token`: require `Authorization: Bearer <token>`, `supabase.auth.getUser`
  → email (401 if invalid); sign and return `{ token }`. 503 if `QUOTE_HANDOFF_SECRET`
  unset. Add `createHmac` to the existing `crypto` import.

### quote (`blind-bot-quoting`)
- `lib/auth/blindbot-handoff.ts`: replace the blind-bot-Supabase `getUser` validation with
  local HMAC verification (`verifyHandoffToken(token) → email | null`); the rest
  (`createUser` + `generateLink` + `verifyOtp` + `ensureProfileLinked`) is unchanged.
- Delete `lib/supabase/blindbot.ts` (no longer needed) and drop the now-unused
  `BLINDBOT_SUPABASE_*` from `.env.local`. Add `QUOTE_HANDOFF_SECRET`.
- `POST /api/handoff` is otherwise unchanged (form fields, 303 redirects).

### blind-bot-frontend
- `installer-portal/page.tsx`: in the effect, call
  `POST {NEXT_PUBLIC_API_URL}/quote-handoff-token` with the Supabase `access_token` as a
  Bearer; put the returned narrow token into `quoteAuthToken`. On any failure, leave it
  unset (ResultStep falls back to the GET link). Dep stays at shared-ui v0.1.174.

### blind-bot-shared-ui
- No change (v0.1.174 already forwards `quoteAuthToken`).

## Security

- The broad `access_token` reaches only blind-bot's own backend (expected — it already
  does for other authenticated calls).
- Quote receives a token that carries only an email and expires in 5 minutes; it cannot
  be replayed against blind-bot.
- HMAC is verified constant-time; an unset/mismatched secret fails closed (manual login).
- Cross-origin POST to `/api/handoff` is fine: it trusts the signed token, not a session.

## Verification

- **Quote side (self-contained):** mint a token locally with `QUOTE_HANDOFF_SECRET`
  (`base64url(payload).HMAC`) and `POST /api/handoff` → 303 into `/configure/...` with a
  quote session cookie; a tampered sig or past `exp` → 303 to `/login?next=`.
- **blind-bot-server:** `POST /quote-handoff-token` with a valid Bearer access_token
  returns `{ token }`; missing/invalid Bearer → 401; unset secret → 503.
- **End-to-end (operator, needs a live blind-bot login + secret on both Render services):**
  logged into blind-bot → "Get a quote" → new tab lands authenticated in the quote
  configurator with the design imported.
- `npm run lint` + `npx tsc --noEmit` clean (quote).
