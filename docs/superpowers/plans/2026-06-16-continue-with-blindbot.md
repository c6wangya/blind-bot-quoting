# Continue-with-BlindBot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A verified handoff: blind-bot POSTs the retailer's blind-bot Supabase access_token to quote, which validates it, auto-provisions/links a quote account, mints a session, and lands the retailer in the configurator with the design imported — no manual sign-in.

**Architecture:** Quote gains a read-only client for blind-bot's auth Supabase (validate token via `getUser`), a server-side bridge (`createUser` + `generateLink` magiclink + `verifyOtp` to set the cookie session), and a `POST /api/handoff` route. blind-bot's `ResultStep` renders a POST form (instead of a link) when given the session token; the frontend supplies it.

**Tech Stack:** Next.js 16 App Router, `@supabase/ssr` + `@supabase/supabase-js`, React 19, TypeScript. **No test suite** — gate each task on `npm run lint` + `npx tsc --noEmit` + the manual check named in the task.

**Spec:** `docs/superpowers/specs/2026-06-16-continue-with-blindbot-design.md`

**Repos:** quote (`blind-bot-quoting`, Tasks 1–4), `blind-bot-shared-ui` (Task 5), `blind-bot-frontend` (Task 6).

---

### Task 1: Env + blind-bot auth Supabase client (quote)

**Files:** Create `lib/supabase/blindbot.ts`; modify `.env.local`, `.env.example`

- [ ] **Step 1: Add env vars**

To `.env.local` and `.env.example` (blind-bot's **auth** project — public values):

```
# blind-bot auth Supabase (verified "Continue with BlindBot" handoff — validates the
# retailer's blind-bot access_token). Auth project, NOT the image-storage project.
BLINDBOT_SUPABASE_URL=https://hwyucxmmdqbvsiuuskfw.supabase.co
BLINDBOT_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3eXVjeG1tZHFidnNpdXVza2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MzA4OTksImV4cCI6MjA4NTIwNjg5OX0.vOT9PP-7ukxZrPVxcNC02fPwtb-vs2zxSUMev3fveak
```

(`.env.example` uses placeholder values, not the real key.)

- [ ] **Step 2: Create `lib/supabase/blindbot.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only client for blind-bot's AUTH Supabase project — used only to validate a
 * retailer's blind-bot access_token (`auth.getUser(token)`) during the verified handoff.
 * Returns null when env is unset, so the handoff degrades to manual login.
 */
export function blindbotAuth(): SupabaseClient | null {
  const url = process.env.BLINDBOT_SUPABASE_URL;
  const key = process.env.BLINDBOT_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

- [ ] **Step 3: Gate** — `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** — `git add lib/supabase/blindbot.ts .env.example && git commit -m "THE-772: blind-bot auth Supabase client + env"`

---

### Task 2: Handoff bridge — `lib/auth/blindbot-handoff.ts` (quote)

**Files:** Create `lib/auth/blindbot-handoff.ts`

- [ ] **Step 1: Write the bridge**

```ts
import { admin } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { blindbotAuth } from "@/lib/supabase/blindbot";
import { ensureProfileLinked } from "@/lib/auth/profile";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Validate a blind-bot access_token, provision/link a quote account for that email,
 * and establish a quote session (cookies). Returns true on success; false means the
 * caller should fall back to manual login. Never throws.
 */
export async function completeBlindbotHandoff(token: string): Promise<boolean> {
  try {
    const bb = blindbotAuth();
    if (!bb) return false;
    const { data: { user }, error } = await bb.auth.getUser(token);
    if (error || !user?.email) return false;
    const email = user.email;

    // Provision (idempotent — ignore "already registered").
    await admin().auth.admin.createUser({ email, email_confirm: true });

    // Mint a quote session without a password: generate a magiclink token, verify it.
    const { data: link, error: linkErr } = await admin().auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) return false;

    const supabase = await createServerClient();
    if (!supabase) return false;
    const { error: otpErr } = await supabase.auth.verifyOtp({
      type: (link.properties.verification_type ?? "magiclink") as EmailOtpType,
      token_hash: link.properties.hashed_token,
    });
    if (otpErr) return false;

    await ensureProfileLinked();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Gate** — `npx tsc --noEmit` clean. (If `createUser` for an existing email surfaces as a rejected promise in this SDK version, wrap that one call in its own `try {} catch {}`; the outer try already covers it.)
- [ ] **Step 3: Commit** — `git add lib/auth/blindbot-handoff.ts && git commit -m "THE-772: blind-bot handoff bridge (validate + provision + mint session)"`

---

### Task 3: `POST /api/handoff` route (quote)

**Files:** Create `app/api/handoff/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { completeBlindbotHandoff } from "@/lib/auth/blindbot-handoff";

// Quote owns the catalog: map blind-bot's QuoteLine to the default product line page.
const QUOTE_DEFAULT_PRODUCT: Record<string, string> = {
  "roller-shade": "rs-aria",
  drapery: "dp-velluto",
};

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const line = String(form.get("line") ?? "");
  const img = String(form.get("img") ?? "");
  const cfg = String(form.get("cfg") ?? "");

  const product = QUOTE_DEFAULT_PRODUCT[line] ?? "rs-aria";
  const params = new URLSearchParams();
  if (img) params.set("img", img);
  if (cfg) params.set("cfg", cfg);
  if (line) params.set("line", line);
  const dest = `/configure/${product}?${params.toString()}`;
  const origin = new URL(req.url).origin;

  const ok = token ? await completeBlindbotHandoff(token) : false;
  // 303: turn the POST into a GET of the destination.
  if (ok) return NextResponse.redirect(`${origin}${dest}`, { status: 303 });
  return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(dest)}`, { status: 303 });
}
```

- [ ] **Step 2: Gate** — `npm run lint` + `npx tsc --noEmit` clean.

- [ ] **Step 3: Manual** — with a real blind-bot `access_token` (copy from a logged-in blind-bot tab: `localStorage`/devtools → the Supabase session), run:

```bash
curl -i -X POST http://localhost:3001/api/handoff \
  --data-urlencode "token=<REAL_BLINDBOT_ACCESS_TOKEN>" \
  --data-urlencode "line=roller-shade" \
  --data-urlencode "img=https://iashgsuvdedpdmytdbgw.supabase.co/storage/v1/object/public/landing-page/demo/demo_1/Hallway%20Before.jpg" \
  --data-urlencode 'cfg={"Color":"White"}'
```

Expected: `303` with `Location: /configure/rs-aria?...` and `set-cookie` for the quote session. A bogus token → `303` to `/login?next=...` with no session cookie.

- [ ] **Step 4: Commit** — `git add "app/api/handoff/route.ts" && git commit -m "THE-772: POST /api/handoff — verified blind-bot handoff entry"`

---

### Task 4: Push quote branch + open PR

- [ ] **Step 1:** `npm run lint` + `npx tsc --noEmit` clean.
- [ ] **Step 2:** Push `yanyan/the-772-continue-with-blindbot`, open PR against `main`. Note in the PR that the blind-bot-side change (Tasks 5–6) lands separately and that `BLINDBOT_SUPABASE_*` env must be set.

---

### Task 5: `ResultStep` POST form (blind-bot-shared-ui)

**Repo:** `C:\Users\PC\Documents\blind-bot-shared-ui` (branch `yanyan/the-772-quote-handoff-button`)
**Files:** Modify `src/enterprise/components/ResultStep.tsx`

- [ ] **Step 1: Extract a cfg builder** (so the form and the legacy link share it). Just above `buildQuoteUrl` (~line 423):

```ts
function buildQuoteCfg(options: Record<string, string | undefined>): string {
  const cfg: Record<string, string> = {};
  for (const [k, v] of Object.entries(options)) {
    if (typeof v === "string" && v && v !== "Default" && v !== "Original") cfg[k] = v;
  }
  return JSON.stringify(cfg);
}
```

Then change `buildQuoteUrl` to use it:

```ts
function buildQuoteUrl(line: QuoteLine, imageUrl: string, options: Record<string, string | undefined>): string {
  const params = new URLSearchParams({ line, img: imageUrl, cfg: buildQuoteCfg(options) });
  return `${QUOTE_BASE_URL}/configure/${QUOTE_DEFAULT_PRODUCT[line]}?${params.toString()}`;
}
```

- [ ] **Step 2: Add the prop** — add `quoteAuthToken?: string;` to the `ResultStep` props interface (near `onRegenerateFromHistory`, ~line 148) and to the destructured params (after `onChangeProduct`, ~line 448): `quoteAuthToken,`.

- [ ] **Step 3: Render a POST form when a token is present.** Replace the `{quoteLine && ( <a ...>Get a quote →</a> )}` block (~line 1723) with:

```tsx
                    {quoteLine && (
                      quoteAuthToken ? (
                        <form
                          method="POST"
                          action={`${QUOTE_BASE_URL}/api/handoff`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: 'inline' }}
                        >
                          <input type="hidden" name="token" value={quoteAuthToken} />
                          <input type="hidden" name="line" value={quoteLine} />
                          <input type="hidden" name="img" value={galleryAfterImage} />
                          <input type="hidden" name="cfg" value={buildQuoteCfg(effectiveOptions)} />
                          <button type="submit" className="ep-btn ep-btn-primary ep-btn-sm">
                            Get a quote →
                          </button>
                        </form>
                      ) : (
                        <a
                          className="ep-btn ep-btn-primary ep-btn-sm"
                          href={buildQuoteUrl(quoteLine, galleryAfterImage, effectiveOptions)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Get a quote →
                        </a>
                      )
                    )}
```

- [ ] **Step 4: Gate** — in shared-ui: `npm run build` (or its typecheck script) clean.
- [ ] **Step 5: Commit** — `git add src/enterprise/components/ResultStep.tsx && git commit -m "THE-772: ResultStep verified POST handoff when quoteAuthToken present"` and push the branch.

---

### Task 6: Frontend passes `quoteAuthToken` (blind-bot-frontend)

**Repo:** `C:\Users\PC\Documents\blind-bot-frontend`
**Files:** the component that renders the enterprise installer result (the shared-ui wrapper that internally renders `ResultStep`), plus a yalc refresh.

- [ ] **Step 1: Locate the render site.** `<ResultStep>` is not rendered directly in the frontend — it's inside a shared-ui wrapper the frontend mounts. Find the wrapper that the frontend renders for the installer result and the prop it forwards to `ResultStep`. Search shared-ui for the component that renders `<ResultStep` and trace which exported component the frontend uses; thread a `quoteAuthToken` prop through that wrapper down to `ResultStep`.

- [ ] **Step 2: Supply the token in the frontend.** Where that wrapper is mounted, read the current session token and pass it:

```ts
import { supabase } from "@/libs/supabase-client";
// …in an effect/loader near where the installer result is shown:
const { data } = await supabase.auth.getSession();
const quoteAuthToken = data.session?.access_token ?? undefined;
// …pass quoteAuthToken into the wrapper that renders ResultStep.
```

- [ ] **Step 3: Refresh the local shared-ui build** so the frontend picks up Task 5: in shared-ui `npm run build` then `yalc push` (or `yalc publish` + `yalc update` in the frontend), per the existing local-consumption setup.

- [ ] **Step 4: Gate** — frontend `npm run lint` (or typecheck) clean; the installer result renders with the handoff flag on.

- [ ] **Step 5: Manual end-to-end** — with `NEXT_PUBLIC_QUOTE_HANDOFF_ENABLED=true`, log into blind-bot, reach a roller/drapery result, click "Get a quote" → a new tab opens, POSTs to quote, and lands **authenticated** in `/configure/rs-aria` with the design imported and a quote `profiles` row for that email — no manual sign-in.

- [ ] **Step 6: Commit** in the frontend repo (and shared-ui if `yalc` touched lockfiles), with message `THE-772: pass quoteAuthToken to enterprise ResultStep for verified handoff`.

---

### Notes / risks

- **`verifyOtp` type:** the plan uses `link.properties.verification_type` (falls back to `"magiclink"`). If a given SDK build rejects that, `"email"` is the alternative `EmailOtpType` for magiclink token hashes.
- **Cross-origin POST + cookies:** the quote session cookies are set on the quote origin during the 303; the new tab navigates to the quote configure page carrying them. `SameSite=Lax` cookies are sent on the top-level GET that the 303 triggers.
- **Tasks 5–6 require the running frontend + yalc** to verify end-to-end; Tasks 1–4 (the quote side) are independently testable with a real token via curl.
