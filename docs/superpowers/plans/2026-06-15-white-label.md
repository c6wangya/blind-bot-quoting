# White-label ("Loom & Shade") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the retailer-visible BlindBot identity from the quote service behind a configurable brand ("Loom & Shade"), and hide the carried-over result image's origin.

**Architecture:** A single `lib/brand.ts` constant (env-overridable) feeds every retailer-facing surface (sidebar, login, page title, supplier Excel). A new `/api/img` proxy route streams the result image through the quote origin; the Configurator points its `<img>` at the proxy and strips the handoff params from the address bar on mount.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, exceljs. **No test suite in this repo** — the per-task gate is `npm run lint` + `npx tsc --noEmit` + the manual check named in each task.

**Spec:** `docs/superpowers/specs/2026-06-15-white-label-design.md`

---

### Task 1: Brand config single-source

**Files:**
- Create: `lib/brand.ts`
- Modify: `.env.local`, `.env.example` (append the three vars, commented)

- [ ] **Step 1: Create `lib/brand.ts`**

```ts
// Single source of truth for the white-label brand shown to retailers.
// Overridable per-deploy via NEXT_PUBLIC_* env vars; these are only the defaults.
// NEXT_PUBLIC_ so the same values resolve in both client and server contexts.
const name = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Loom & Shade";

export const BRAND = {
  name,
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE ?? "Trade Portal",
  monogram: process.env.NEXT_PUBLIC_BRAND_MONOGRAM ?? "LS",
  /** Filename-safe form, e.g. "LoomAndShade". */
  slug: name.replace(/&/g, "And").replace(/[^A-Za-z0-9]+/g, ""),
};
```

- [ ] **Step 2: Append to `.env.example` and `.env.local`**

```
# White-label brand (retailer-facing). Defaults to "Loom & Shade".
NEXT_PUBLIC_BRAND_NAME=Loom & Shade
NEXT_PUBLIC_BRAND_TAGLINE=Trade Portal
NEXT_PUBLIC_BRAND_MONOGRAM=LS
# Comma-separated hostnames /api/img is allowed to proxy. Must include the host
# the blind-bot result image is served from. Defaults to the BLINDBOT_API_URL host.
IMG_PROXY_ALLOWED_HOSTS=
```

- [ ] **Step 3: Gate** — `npx tsc --noEmit` clean (new file compiles, unused is fine for now).

- [ ] **Step 4: Commit** — `git add lib/brand.ts .env.example .env.local && git commit -m "THE-772: brand config single-source (lib/brand.ts)"`

---

### Task 2: Apply brand to sidebar, login, page title

**Files:**
- Modify: `components/Sidebar.tsx:41-49`
- Modify: `components/LoginForm.tsx:22, 70-71`
- Modify: `app/layout.tsx:8-12`

- [ ] **Step 1: Sidebar — import + logo block**

Add import after the existing imports: `import { BRAND } from "@/lib/brand";`

Replace the logo block (currently the brass square with `B`, "BlindBots", "Trade Portal"):

```tsx
      <Link href="/" className="flex items-center gap-3 px-5 pb-5 pt-6">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brass to-[#8a6a39] text-base font-bold shadow-md">
          {BRAND.monogram}
        </div>
        <div>
          <div className="text-[15px] font-semibold leading-tight tracking-tight">{BRAND.name}</div>
          <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">{BRAND.tagline}</div>
        </div>
      </Link>
```

- [ ] **Step 2: LoginForm — both headings**

Add import: `import { BRAND } from "@/lib/brand";`

Both `<h1 ...>Trade Portal</h1>` occurrences (line 22 inside the no-supabase fallback, line 70 in the main form) become:

```tsx
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{BRAND.name}</h1>
```

- [ ] **Step 3: layout.tsx metadata**

Add import: `import { BRAND } from "@/lib/brand";` and change the metadata:

```ts
export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description:
    "B2B quoting & pre-order portal for window treatments — factory-direct to retailers.",
};
```

- [ ] **Step 4: Gate** — `npm run lint` + `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual** — load `/login` → heading reads "Loom & Shade"; sign in → sidebar shows `LS` + "Loom & Shade / Trade Portal"; browser tab title reads "Loom & Shade".

- [ ] **Step 6: Commit** — `git add components/Sidebar.tsx components/LoginForm.tsx app/layout.tsx && git commit -m "THE-772: brand sidebar, login, page title"`

---

### Task 3: Rebrand the supplier Excel

**Files:**
- Modify: `lib/excel.ts:32, 46, 153, 163`

- [ ] **Step 1: Import** — add at top of `lib/excel.ts`: `import { BRAND } from "./brand";`

- [ ] **Step 2: Replace the four BlindBots strings**

- Line 32: `wb.creator = \`${BRAND.name} ${BRAND.tagline}\`;`
- Line 46: `title.value = \`预订单 PRE-ORDER — ${BRAND.name}\`;`
- Line 153 (instructions item 1):
```ts
    `1. 本预订单由 ${BRAND.name} 自动生成。 This pre-order was generated automatically by ${BRAND.name}.`,
```
- Line 163 (filename): `return { buffer, filename: \`${order.ref}_${BRAND.slug}_PreOrder.xlsx\` };`

- [ ] **Step 3: Gate** — `npx tsc --noEmit` clean.

- [ ] **Step 4: Manual** — open an order detail page, download the Excel; the title cell, the instructions sheet, and the filename all read "Loom & Shade" / `..._LoomAndShade_PreOrder.xlsx` with no "BlindBots".

- [ ] **Step 5: Commit** — `git add lib/excel.ts && git commit -m "THE-772: brand the supplier pre-order Excel"`

---

### Task 4: Image proxy route

**Files:**
- Create: `app/api/img/route.ts`

- [ ] **Step 1: Create the route handler**

```ts
// Streams the carried-over result image through the quote origin so the browser's
// network panel never reveals the upstream (blind-bot) host. Allowlisted to prevent
// the route from being an open proxy / SSRF vector.

function hostOf(u: string | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const ALLOWED_HOSTS = (process.env.IMG_PROXY_ALLOWED_HOSTS || hostOf(process.env.BLINDBOT_API_URL))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export async function GET(req: Request) {
  const src = new URL(req.url).searchParams.get("src");
  if (!src) return new Response("missing src", { status: 400 });

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return new Response("invalid src", { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return new Response("invalid scheme", { status: 400 });
  }
  if (!ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
    return new Response("host not allowed", { status: 400 });
  }

  try {
    const upstream = await fetch(url.toString(), { cache: "no-store" });
    if (!upstream.ok) return new Response("upstream error", { status: 502 });
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: { "content-type": contentType, "cache-control": "public, max-age=3600" },
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
```

- [ ] **Step 2: Set the allowlist env** — find the actual host of the blind-bot result image (from a real handoff URL, or the blind-bot frontend's result image config) and set `IMG_PROXY_ALLOWED_HOSTS` in `.env.local` to include it (plus the API host). If the image is served from the same host as `BLINDBOT_API_URL`, the default already covers it.

- [ ] **Step 3: Gate** — `npx tsc --noEmit` clean.

- [ ] **Step 4: Manual** — `curl -i "http://localhost:3001/api/img?src=<a real allowed image url>"` returns 200 + an image content-type; `curl -i "http://localhost:3001/api/img?src=https://evil.example/x.png"` returns 400.

- [ ] **Step 5: Commit** — `git add app/api/img/route.ts .env.local && git commit -m "THE-772: add allowlisted image proxy route"`

---

### Task 5: Configurator — use the proxy + strip handoff params

**Files:**
- Modify: `components/Configurator.tsx` (the `<img>` at ~line 177; add a mount effect)

- [ ] **Step 1: Compute the proxied URL**

Just after `const prefill = mapImportedConfig(...)` (around line 42), add:

```tsx
  // Route the carried-over image through our own origin so the upstream host is hidden.
  const carriedImageSrc = imported ? `/api/img?src=${encodeURIComponent(imported.img)}` : null;
```

- [ ] **Step 2: Point the `<img>` at the proxy**

Change `src={imported.img}` to `src={carriedImageSrc ?? ""}`.

- [ ] **Step 3: Strip handoff params from the address bar on mount**

Add this effect near the other `useEffect`s (after the price effect block, ~line 137):

```tsx
  // Once the import payload has been read (server-side, into props), drop the handoff
  // params from the visible URL so the upstream image URL doesn't linger in the address
  // bar or browser history.
  useEffect(() => {
    if (!imported) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("img") || url.searchParams.has("cfg") || url.searchParams.has("line")) {
      url.searchParams.delete("img");
      url.searchParams.delete("cfg");
      url.searchParams.delete("line");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 4: Gate** — `npm run lint` + `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual** — open a handoff URL (`/configure/rs-aria?img=…&cfg=…&line=roller`); the carried-over image still renders; DevTools → Network shows the image request going to `/api/img` on `localhost:3001`, not to blind-bot; the address bar no longer shows `img`/`cfg`/`line` after load.

- [ ] **Step 6: Commit** — `git add components/Configurator.tsx && git commit -m "THE-772: proxy carried-over image + strip handoff params"`

---

### Task 6: Final verification

- [ ] **Step 1: Residual-trace grep**

Run: `git grep -niE "blindbot|trade portal" -- app components lib`
Expected: matches only in `lib/brand.ts` (the `BRAND.tagline` default "Trade Portal") and the intentionally-kept internal references — `lib/import.ts` comments, `lib/auth/profile.ts` (comments + `blindbot*` API helpers + column names). No other retailer-facing hardcodes.

- [ ] **Step 2: Full gate** — `npm run lint` and `npx tsc --noEmit` both clean.

- [ ] **Step 3: End-to-end manual** — fresh login shows Loom & Shade everywhere (sidebar, login, tab); a handoff import renders via `/api/img` with a clean address bar; an order's Excel downloads as `..._LoomAndShade_PreOrder.xlsx` branded throughout.

- [ ] **Step 4: Push branch + open PR** against `main`.
