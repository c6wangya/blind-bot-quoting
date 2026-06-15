# Permission hardening — role gating & ownership

**Ticket:** THE-772 (sub-project 7) · **Date:** 2026-06-15

## Problem

The quote service has no role concept and enforces ownership inconsistently, so
retailer-only and back-office surfaces are exposed:

- `/supplier` (Supplier Console) and `/pricing` have no gate; the Supplier Console even
  calls `getOrders()` unfiltered, showing every retailer's orders.
- `POST /api/orders/:id/advance`, `POST /api/quotes/:id/submit`, and
  `GET /api/orders/:id/excel` have **no auth at all** — any caller can drive any order's
  state machine, submit any quote, or download any order's workbook (retailer name +
  prices), a cross-tenant leak.
- The `/orders/:id` and `/quotes/:id` detail pages fetch by id without an ownership
  check.

All DB access goes through the `service_role` client, which bypasses RLS, so today the
only possible enforcement is at the application layer.

## Decisions (locked)

- **Role model:** a `role` column on `profiles` (`retailer` | `admin`). Admins are
  internal staff who may use the Supplier Console + Pricing; retailers may not.
- **RLS:** out of scope this round. Real RLS requires moving DB reads off `service_role`
  to per-user JWT clients — a separate sub-project. App-layer guards are the deliverable.
- **Blocked UX:** non-admins don't see the "Supply Chain" sidebar group, and a direct
  visit to `/supplier` or `/pricing` returns `notFound()` (404 — does not reveal the
  pages exist).
- **Advance is admin-only:** it simulates the supplier/logistics side; retailers must not
  advance their own orders' production/shipping state.
- **Demo admin:** `yy100922@gmail.com` is granted `admin`.

## Design

### 1. Schema — `profiles.role`

Run once in the Supabase SQL editor (where `profiles` was originally created):

```sql
alter table public.profiles
  add column role text not null default 'retailer'
  check (role in ('retailer','admin'));

update public.profiles set role = 'admin' where email = 'yy100922@gmail.com';
```

New profiles get `retailer` from the column default; `ensureProfileLinked` is unchanged
(it never sets `role`). Granting admin is always a deliberate `update`.

### 2. Data helpers — `lib/db.ts`

- Extend `getProfile(userId)` to also select `role`, returning
  `{ email, company, role }` (role typed as `"retailer" | "admin"`, defaulting to
  `"retailer"` if the column is somehow null).
- Add ownership lookups (null = public demo sample, undefined = not found):

```ts
export async function getQuoteOwnerId(quoteId: number): Promise<string | null | undefined> {
  const { data } = await admin().from("quotes").select("owner_id").eq("id", quoteId).maybeSingle();
  return data ? (data as { owner_id: string | null }).owner_id : undefined;
}

export async function getOrderOwnerId(orderId: number): Promise<string | null | undefined> {
  const { data: o } = await admin().from("orders").select("quote_id").eq("id", orderId).maybeSingle();
  if (!o) return undefined;
  return getQuoteOwnerId((o as { quote_id: number }).quote_id);
}
```

### 3. Auth-policy helpers — `lib/auth/user.ts`

```ts
export async function isAdmin(userId: string): Promise<boolean> {
  const profile = await getProfile(userId);
  return profile?.role === "admin";
}

/** Page guard: require a signed-in admin; otherwise 404 (notFound). Returns the user id. */
export async function requireAdminPage(next: string): Promise<string> {
  const id = await requireUserId(next);
  if (!(await isAdmin(id))) notFound();
  return id;
}
```

`requireUserId` already redirects unauthenticated users to `/login?next=`. `notFound()`
is imported from `next/navigation`. (To avoid a circular import, `isAdmin` imports
`getProfile` from `lib/db.ts`; `db.ts` does not import `user.ts`.)

An ownership helper shared by the detail pages:

```ts
/** True if this user may see/act on a record with the given owner (own, public demo, or admin). */
export async function canAccessOwned(userId: string, ownerId: string | null | undefined): Promise<boolean> {
  if (ownerId === undefined) return false;       // record not found
  if (ownerId === null) return true;             // public demo sample
  if (ownerId === userId) return true;           // own record
  return isAdmin(userId);                         // admins see all
}
```

### 4. Page guards

- `app/(portal)/supplier/page.tsx` and `app/(portal)/pricing/page.tsx`: first line
  `await requireAdminPage("/supplier")` (resp. `/pricing`). `getOrders()` stays
  unfiltered in the Supplier Console — correct, an admin sees all.
- `app/(portal)/orders/[id]/page.tsx`: after loading, `const userId = await
  requireUserId(...)`; `if (!(await canAccessOwned(userId, await getOrderOwnerId(id)))) notFound();`.
- `app/(portal)/quotes/[id]/page.tsx`: same with `getQuoteOwnerId(id)`.

### 5. Sidebar — hide back-office for non-admins

`app/(portal)/layout.tsx` already fetches the profile; derive
`const isAdmin = profile?.role === "admin"` and pass `isAdmin` to `<Sidebar>`. `Sidebar`
takes an `isAdmin: boolean` prop and filters the nav: the "Supply Chain" group renders
only when `isAdmin`. (The "Retailer Portal" group always renders.)

### 6. API route guards (JSON responses)

Each handler resolves the caller with `getCurrentUserId()`:

- `POST /api/orders/:id/advance` — `401` if no user; `403` if not admin. Then proceed.
- `POST /api/quotes/:id/submit` — `401` if no user; resolve `getQuoteOwnerId(id)`; if
  `!canAccessOwned(userId, owner)` return `404` (don't reveal others' quotes). Then
  proceed.
- `GET /api/orders/:id/excel` — `401` if no user; resolve `getOrderOwnerId(id)`; if
  `!canAccessOwned(userId, owner)` return `404`. Then build the workbook.

Unchanged: `POST /api/quote-items` (already requires auth, operates on the caller's own
draft); `POST /api/price` (stateless catalog math, no record exposure — intentionally
open so it works on every configurator keystroke).

## Out of scope

- **Real RLS** — DB access stays on `service_role`; enforcing RLS means a per-user-JWT
  client refactor of `lib/db.ts` (separate sub-project).
- **A real, separate supplier login** — the `admin` role stands in for the supplier/
  back-office actor for now.

## Verification

- As retailer (a non-admin account): the sidebar has no "Supply Chain" group; visiting
  `/supplier` or `/pricing` returns 404; `GET /api/orders/:id/excel` for an order that
  isn't theirs returns 404; `POST /api/orders/:id/advance` returns 403.
- As admin (`yy100922@gmail.com`): Supplier Console lists all orders and advance works;
  Pricing is visible.
- Own records still work end-to-end: a retailer can view their own quote/order detail,
  download their own order's Excel, and submit their own pre-order.
- `npm run lint` and `npx tsc --noEmit` clean.
