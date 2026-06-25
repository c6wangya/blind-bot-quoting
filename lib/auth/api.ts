import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { canAccessOwned, getCurrentUserId, isAdmin, userClient } from "@/lib/auth/user";
import { admin } from "@/lib/supabase/admin";
import { getOrderOwnerId, getOrderQuoteId, getQuoteOwnerId } from "@/lib/db";
import { verifyInvoiceToken } from "@/lib/invoice-token";

/**
 * Shared ownership gate for `/[id]` API routes. Resolves the route's `id`, requires a
 * signed-in user, and checks ownership via the given owner-lookup — returning the parsed
 * id + uid + an RLS-scoped client on success, or a ready-to-return NextResponse (401/404)
 * on failure. Usage:
 *
 *   const gate = await requireQuoteAccess(ctx);
 *   if (gate instanceof NextResponse) return gate;
 *   const { id, sb } = gate;
 */
export type Access = { id: number; uid: string; sb: SupabaseClient };

async function requireAccess(
  ctx: { params: Promise<{ id: string }> },
  ownerLookup: (id: number) => Promise<string | null | undefined>
): Promise<Access | NextResponse> {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessOwned(uid, await ownerLookup(id)))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return { id, uid, sb: await userClient() };
}

export const requireQuoteAccess = (ctx: { params: Promise<{ id: string }> }) =>
  requireAccess(ctx, getQuoteOwnerId);

export const requireOrderAccess = (ctx: { params: Promise<{ id: string }> }) =>
  requireAccess(ctx, getOrderOwnerId);

/** Access granted either by login+ownership OR by a valid pay-by-link invoice token. `viaToken`
 *  flags the anonymous path (no uid, service_role client). */
export type TokenAccess = { id: number; sb: SupabaseClient; viaToken: boolean };

/** The invoice share token from the request — header (client fetch) or `?t=` (direct navigation). */
function invoiceTokenFrom(req: Request): string | null {
  const h = req.headers.get("x-invoice-token");
  if (h) return h;
  try {
    return new URL(req.url).searchParams.get("t");
  } catch {
    return null;
  }
}

/**
 * Gate a `/[id]` payment route, allowing EITHER the owner (login + RLS) OR an anonymous holder of a
 * valid invoice token. `ownerLookup` resolves the route id's owner; `quoteIdLookup` maps the route id
 * to the quote the token is bound to (identity for quote routes, order→quote for order routes).
 */
async function requireAccessOrInvoiceToken(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
  ownerLookup: (id: number) => Promise<string | null | undefined>,
  quoteIdLookup: (id: number) => Promise<number | null>
): Promise<TokenAccess | NextResponse> {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const uid = await getCurrentUserId();
  if (uid && (await canAccessOwned(uid, await ownerLookup(id)))) {
    return { id, sb: await userClient(), viaToken: false };
  }
  const qid = await quoteIdLookup(id);
  if (qid != null && verifyInvoiceToken(qid, invoiceTokenFrom(req))) {
    return { id, sb: admin(), viaToken: true }; // anonymous pay-by-link — amount is server-computed
  }
  return NextResponse.json({ error: uid ? "Not found" : "Unauthorized" }, { status: uid ? 404 : 401 });
}

export const requireQuoteAccessOrToken = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  requireAccessOrInvoiceToken(req, ctx, getQuoteOwnerId, async (id) => id);

export const requireOrderAccessOrToken = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  requireAccessOrInvoiceToken(req, ctx, getOrderOwnerId, getOrderQuoteId);

/**
 * Admin-only gate for back-office API routes. Returns the RLS-scoped client on success
 * (writes still pass the DB's admin policies), or a 401/403 NextResponse. Usage:
 *
 *   const sb = await requireAdmin();
 *   if (sb instanceof NextResponse) return sb;
 */
export async function requireAdmin(): Promise<SupabaseClient | NextResponse> {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return userClient();
}
