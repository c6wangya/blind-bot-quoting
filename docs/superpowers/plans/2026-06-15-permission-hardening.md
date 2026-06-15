# Permission Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the back-office surfaces (Supplier Console, Pricing, order advance) to admins and enforce per-record ownership on order/quote detail, submit, and Excel — closing the current cross-tenant and no-auth holes.

**Architecture:** A `role` column on `profiles` (`retailer`|`admin`) read through `getProfile`. Auth-policy helpers (`isAdmin`, `requireAdminPage`, `canAccessOwned`) + ownership lookups (`getQuoteOwnerId`, `getOrderOwnerId`) are applied as guards on pages and API routes. DB access stays on `service_role`; RLS is deferred.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres via service_role). **No test suite** — gate each task on `npm run lint` + `npx tsc --noEmit` + the manual check named in the task.

**Spec:** `docs/superpowers/specs/2026-06-15-permission-hardening-design.md`

---

### Task 1: Schema migration — `profiles.role`

**Files:** none (manual SQL in the Supabase SQL editor, where `profiles` was created).

- [ ] **Step 1: Run the migration**

In Supabase → SQL editor, run:

```sql
alter table public.profiles
  add column role text not null default 'retailer'
  check (role in ('retailer','admin'));

update public.profiles set role = 'admin' where email = 'yy100922@gmail.com';
```

- [ ] **Step 2: Verify the column + grant**

Run a one-off check (service_role) — expect a row with `role = admin` for the demo user:

```bash
node -e "const fs=require('fs');const {createClient}=require('@supabase/supabase-js');const e={};for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)e[m[1]]=m[2].trim();}const sb=createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});sb.from('profiles').select('email,role').then(({data,error})=>console.log(error||data));"
```

Expected: prints rows including `{ email: 'yy100922@gmail.com', role: 'admin' }`, others `role: 'retailer'`.

- [ ] **Step 3:** No commit (schema change is external; the SQL is recorded in the spec).

---

### Task 2: Data helpers — `lib/db.ts`

**Files:** Modify `lib/db.ts` (the `getProfile` function ~line 54; add two helpers after it)

- [ ] **Step 1: Extend `getProfile` to include `role`**

Replace the existing `getProfile`:

```ts
export async function getProfile(
  userId: string
): Promise<{ email: string; company: string | null; role: "retailer" | "admin" } | null> {
  const { data, error } = await admin()
    .from("profiles")
    .select("email, company, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { email: string; company: string | null; role: string | null };
  return { email: row.email, company: row.company, role: row.role === "admin" ? "admin" : "retailer" };
}
```

- [ ] **Step 2: Add ownership lookups immediately after `getProfile`**

```ts
/** Owner of a quote: a user id, null for public demo samples, or undefined if not found. */
export async function getQuoteOwnerId(quoteId: number): Promise<string | null | undefined> {
  const { data } = await admin().from("quotes").select("owner_id").eq("id", quoteId).maybeSingle();
  return data ? (data as { owner_id: string | null }).owner_id : undefined;
}

/** Owner of an order (via its quote): a user id, null for public demo samples, or undefined if not found. */
export async function getOrderOwnerId(orderId: number): Promise<string | null | undefined> {
  const { data: o } = await admin().from("orders").select("quote_id").eq("id", orderId).maybeSingle();
  if (!o) return undefined;
  return getQuoteOwnerId((o as { quote_id: number }).quote_id);
}
```

- [ ] **Step 3: Gate** — `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit** — `git add lib/db.ts && git commit -m "THE-772: getProfile role + quote/order owner lookups"`

---

### Task 3: Auth-policy helpers — `lib/auth/user.ts`

**Files:** Modify `lib/auth/user.ts`

- [ ] **Step 1: Update the import + append helpers**

Change the first import line from `import { redirect } from "next/navigation";` to:

```ts
import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/db";
```

Append at the end of the file:

```ts
/** True if the user's profile role is admin. */
export async function isAdmin(userId: string): Promise<boolean> {
  const profile = await getProfile(userId);
  return profile?.role === "admin";
}

/** Page guard: require a signed-in admin; 404 otherwise. Returns the user id. */
export async function requireAdminPage(next: string): Promise<string> {
  const id = await requireUserId(next);
  if (!(await isAdmin(id))) notFound();
  return id;
}

/** Whether a user may see/act on a record: own, public demo (null), or admin. */
export async function canAccessOwned(userId: string, ownerId: string | null | undefined): Promise<boolean> {
  if (ownerId === undefined) return false; // not found
  if (ownerId === null) return true; // public demo sample
  if (ownerId === userId) return true; // own
  return isAdmin(userId);
}
```

(No import cycle: `lib/db.ts` does not import `lib/auth/user.ts`.)

- [ ] **Step 2: Gate** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit** — `git add lib/auth/user.ts && git commit -m "THE-772: isAdmin / requireAdminPage / canAccessOwned helpers"`

---

### Task 4: Admin-gate the Supplier Console + Pricing pages

**Files:** Modify `app/(portal)/supplier/page.tsx`, `app/(portal)/pricing/page.tsx`

- [ ] **Step 1: Supplier Console guard**

In `app/(portal)/supplier/page.tsx`, add the import `import { requireAdminPage } from "@/lib/auth/user";` and make the first line of the component body:

```tsx
export default async function SupplierConsolePage() {
  await requireAdminPage("/supplier");
  const orders = await getOrders();
```

- [ ] **Step 2: Pricing guard**

In `app/(portal)/pricing/page.tsx`, add `import { requireAdminPage } from "@/lib/auth/user";` and as the first line of the component body (before any data fetch):

```tsx
  await requireAdminPage("/pricing");
```

- [ ] **Step 3: Gate** — `npm run lint` + `npx tsc --noEmit` clean.

- [ ] **Step 4: Manual** — signed in as a non-admin, visiting `/supplier` and `/pricing` returns a 404 page; as the admin (`yy100922@gmail.com`) both render.

- [ ] **Step 5: Commit** — `git add "app/(portal)/supplier/page.tsx" "app/(portal)/pricing/page.tsx" && git commit -m "THE-772: admin-gate Supplier Console + Pricing"`

---

### Task 5: Owner-or-admin guard on order/quote detail pages

**Files:** Modify `app/(portal)/orders/[id]/page.tsx`, `app/(portal)/quotes/[id]/page.tsx`

- [ ] **Step 1: Order detail**

In `app/(portal)/orders/[id]/page.tsx`, add imports `import { canAccessOwned, requireUserId } from "@/lib/auth/user";` and add `getOrderOwnerId` to the existing `@/lib/db` import. After the existing `if (!order) notFound();`:

```tsx
  const userId = await requireUserId(`/orders/${id}`);
  if (!(await canAccessOwned(userId, await getOrderOwnerId(Number(id))))) notFound();
```

- [ ] **Step 2: Quote detail**

In `app/(portal)/quotes/[id]/page.tsx`, add imports `import { canAccessOwned, requireUserId } from "@/lib/auth/user";` and add `getQuoteOwnerId` to the existing `@/lib/db` import. After the existing `if (!quote) notFound();`:

```tsx
  const userId = await requireUserId(`/quotes/${id}`);
  if (!(await canAccessOwned(userId, await getQuoteOwnerId(Number(id))))) notFound();
```

- [ ] **Step 3: Gate** — `npm run lint` + `npx tsc --noEmit` clean.

- [ ] **Step 4: Manual** — viewing your own order/quote detail still works; visiting another retailer's `/orders/:id` or `/quotes/:id` returns 404. (Public demo-sample records, owner null, remain viewable.)

- [ ] **Step 5: Commit** — `git add "app/(portal)/orders/[id]/page.tsx" "app/(portal)/quotes/[id]/page.tsx" && git commit -m "THE-772: owner-or-admin guard on order/quote detail"`

---

### Task 6: Sidebar — hide back-office for non-admins

**Files:** Modify `app/(portal)/layout.tsx`, `components/Sidebar.tsx`

- [ ] **Step 1: Pass `isAdmin` from the layout**

In `app/(portal)/layout.tsx`, after the `accountSub` line, derive admin from the already-fetched profile and pass it through:

```tsx
  const accountSub = profile ? (profile.company ? profile.email : "Retailer account") : "Not signed in";
  const isAdmin = profile?.role === "admin";

  return (
    <>
      <Sidebar draftCount={draftCount} accountName={accountName} accountSub={accountSub} signedIn={!!ownerId} isAdmin={isAdmin} />
```

- [ ] **Step 2: Accept the prop + filter the nav in `Sidebar`**

In `components/Sidebar.tsx`, add `isAdmin` to the props (type `boolean`):

```tsx
export default function Sidebar({
  draftCount,
  accountName,
  accountSub,
  signedIn,
  isAdmin,
}: {
  draftCount: number;
  accountName: string;
  accountSub: string;
  signedIn: boolean;
  isAdmin: boolean;
}) {
```

Then filter the rendered groups — change `{NAV.map((group) => (` to:

```tsx
        {NAV.filter((group) => group.section !== "Supply Chain" || isAdmin).map((group) => (
```

- [ ] **Step 3: Gate** — `npm run lint` + `npx tsc --noEmit` clean.

- [ ] **Step 4: Manual** — as a non-admin the sidebar shows only the "Retailer Portal" group; as admin the "Supply Chain" group (Supplier Console, Pricing Versions) appears.

- [ ] **Step 5: Commit** — `git add "app/(portal)/layout.tsx" components/Sidebar.tsx && git commit -m "THE-772: sidebar hides Supply Chain group for non-admins"`

---

### Task 7: API route guards

**Files:** Modify `app/api/orders/[id]/advance/route.ts`, `app/api/quotes/[id]/submit/route.ts`, `app/api/orders/[id]/excel/route.ts`

- [ ] **Step 1: Advance — admin only**

In `app/api/orders/[id]/advance/route.ts`, add `import { getCurrentUserId, isAdmin } from "@/lib/auth/user";`. Make the first lines of the `POST` body (right after `const { id } = await ctx.params;`):

```ts
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

- [ ] **Step 2: Submit — owner or admin**

Replace the body of `app/api/quotes/[id]/submit/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { canAccessOwned, getCurrentUserId } from "@/lib/auth/user";
import { getQuoteOwnerId, submitPreOrder } from "@/lib/db";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const uid = await getCurrentUserId();
    if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessOwned(uid, await getQuoteOwnerId(Number(id))))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const order = await submitPreOrder(Number(id));
    return NextResponse.json({ order });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 3: Excel — owner or admin**

Replace the body of `app/api/orders/[id]/excel/route.ts` with:

```ts
import { canAccessOwned, getCurrentUserId } from "@/lib/auth/user";
import { getOrderOwnerId } from "@/lib/db";
import { buildOrderWorkbook } from "@/lib/excel";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const uid = await getCurrentUserId();
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessOwned(uid, await getOrderOwnerId(Number(id))))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const { buffer, filename } = await buildOrderWorkbook(Number(id));
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
```

- [ ] **Step 4: Gate** — `npm run lint` + `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual** — as a non-admin, `curl -X POST` to another order's `/advance` → 403, to a foreign `/submit` → 404, `GET` a foreign `/excel` → 404; as admin/owner the same calls succeed for permitted records.

- [ ] **Step 6: Commit** — `git add "app/api/orders/[id]/advance/route.ts" "app/api/quotes/[id]/submit/route.ts" "app/api/orders/[id]/excel/route.ts" && git commit -m "THE-772: auth guards on advance (admin) + submit/excel (owner-or-admin)"`

---

### Task 8: Final verification + PR

- [ ] **Step 1: Full gate** — `npm run lint` and `npx tsc --noEmit` both clean.

- [ ] **Step 2: End-to-end manual** (after the Task 1 migration is applied): restart the dev server so the new env/role is live; as admin (`yy100922@gmail.com`) the Supply Chain group + Supplier Console (all orders) + Pricing work and orders advance; as a retailer those are hidden/404 and foreign records are 404/403, while own quotes/orders/Excel/submit work.

- [ ] **Step 3: Push branch + open PR** against `main`. Note in the PR that the `profiles.role` migration (Task 1 SQL) must be run on the Supabase project before deploy.
