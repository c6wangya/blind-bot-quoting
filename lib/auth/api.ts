import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { canAccessOwned, getCurrentUserId, isAdmin, userClient } from "@/lib/auth/user";
import { getOrderOwnerId, getQuoteOwnerId } from "@/lib/db";

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
