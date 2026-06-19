# Deploying the quote service (Loom & Shade)

Next.js 16 app, Supabase/Postgres data layer, no native deps. Reference deploy: Render.

## 1. Render web service

| Setting | Value |
|---|---|
| Repo | `c6wangya/blind-bot-quoting`, branch `main` |
| Runtime | Node (≥ 20 — pin via `.node-version` if needed) |
| Build command | `npm install && npm run build` |
| Start command | `npm run start` (`next start` honors Render's `$PORT`) |

## 2. Environment variables (Render → Environment)

`NEXT_PUBLIC_*` are inlined at **build** time — after changing any of them, **redeploy** (rebuild).

| Var | What | Secret |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | quote's Supabase project URL | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key | 🔒 |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | quote's Google OAuth client id | |
| `BLINDBOT_API_URL` | blind-bot **server** base URL (email linking) | |
| `QUOTE_HANDOFF_SECRET` | HMAC secret — **must equal blind-bot-server's** | 🔒 |
| `NEXT_PUBLIC_BLINDBOT_FRONTEND_URL` | blind-bot **frontend** origin (enables "Continue with BlindBot"; bounces to `{this}/authorize-quote`) | |
| `IMG_PROXY_ALLOWED_HOSTS` | comma-separated hosts `/api/img` may proxy — **must include blind-bot's render-image storage host(s)** (e.g. the Supabase storage host), else carried images 400 | |
| `NEXT_PUBLIC_BRAND_NAME` / `_TAGLINE` / `_MONOGRAM` | white-label brand (optional; defaults to Loom & Shade) | |

Don't confuse `BLINDBOT_API_URL` (server) with `NEXT_PUBLIC_BLINDBOT_FRONTEND_URL` (frontend).

## 3. One-time Supabase setup (quote's project)

1. **Run the migrations in order** (SQL editor; all idempotent):
   - `supabase/migrations/0001_rls.sql` — Row-Level Security. Without it, RLS isn't enforced.
   - `supabase/migrations/0002_accessory_tags.sql` — accessory tag tables (needs `is_admin()` from 0001).
     Until it's run, the catalog still works — it just shows no tag filters.
   - `supabase/migrations/0003_quote_details.sql` — quote header fields (customer / ship-to / PO /
     Sidemark). Nullable columns only; existing quotes are unaffected.
   - `supabase/migrations/0004_motor_inventory_pricing.sql` — motor stock + per-retailer motor
     pricing (admin-managed). Until run, motors are untracked (unlimited) at the static catalog price.
   - `supabase/migrations/0005_motor_crown_driver.sql` — Crown/Driver option tables (admin-managed,
     priced). Until run, the add-motor flow simply shows no Crown/Driver choice.
2. **Auth → URL Configuration:** Site URL = the deployed origin; Redirect URLs include
   `https://<deploy-origin>/**` (needed for Google login + email confirmation callbacks).
3. **Email/password signup** requires "Confirm email" + working SMTP (Auth → SMTP Settings).
   Until SMTP is configured, use Google or the blind-bot handoff; or turn off "Confirm email".

## 4. Google OAuth (quote's client, in Google Cloud Console)

- **Authorized JavaScript origins:** add the deployed origin.
- **Authorized redirect URIs:** the **Supabase** callback `https://<ref>.supabase.co/auth/v1/callback`
  (domain-independent — *not* the app URL).

## 5. blind-bot side (so the handoff works end to end)

On the **blind-bot frontend** deployment (e.g. beta.theblindbot.com), set + **redeploy**:
- `NEXT_PUBLIC_QUOTE_URL` = this quote service's origin (the "Get a quote" target **and** the
  `redirect_uri` allowlist for the authorize page).
- `NEXT_PUBLIC_QUOTE_HANDOFF_ENABLED=true` (shows the button + mints the handoff token).

On the **blind-bot server**: `QUOTE_HANDOFF_SECRET` must equal the quote value, and it must expose
`POST /quote-handoff-token`.

## 6. Post-deploy smoke check

- `GET /` → 307 `/login`; `/login`, `/catalog`, `/catalog/accessories` → 200.
- `POST /api/price` (a valid config) → 200 with a computation (confirms Supabase env).
- Redirects use the public origin, not `localhost:<port>` (confirms `x-forwarded-*` handling).
- From blind-bot: "Get a quote" → lands on this origin (login / consent / chooser by case) →
  configurator with the carried image → Add to quote → Submit pre-order → Excel downloads.

## Notes
- `.env.local`, `data/`, `.dev-shots/` are gitignored — secrets never live in git.
- `scripts/db-admin.mjs inspect|reseed` — inspect or reset the Supabase demo data.
