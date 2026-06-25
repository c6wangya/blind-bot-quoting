import { cookies } from "next/headers";
import { getCurrentUserId, isAdmin } from "@/lib/auth/user";
import { getProfile } from "@/lib/db";

/**
 * Admin "act-on-behalf-of" (代下单) context.
 *
 * An admin keeps their own identity/session, but can opt into a retailer's context to build a
 * quote and submit a pre-order *as that retailer* — the produced quote/order is owned by the
 * retailer (`quotes.owner_id`), while the action is audited as admin-placed. This is NOT session
 * impersonation: `getCurrentUserId`/`isAdmin` always reflect the real admin, so identity-bound
 * features (messaging, etc.) are untouched.
 *
 * The selected retailer is held in a cookie. The *only* trusted source of "whose data am I
 * building" is `getEffectiveOwnerId()` below — call sites use it for OWNERSHIP, but keep using the
 * real uid + `isAdmin` for AUTHZ (admins can already read/write any owner's records via RLS).
 */
export const ACTING_COOKIE = "bb_acting_as";

export type ActingContext = {
  /** The real signed-in user (always the admin when acting), or null if not signed in. */
  realUid: string | null;
  /** Whether the real user is an admin. */
  isAdmin: boolean;
  /** The retailer being acted for, or null when not acting. */
  actingAsId: string | null;
  /** Display info for the acted-for retailer (null when not acting). */
  retailer: { id: string; name: string } | null;
};

/**
 * Resolve the acting context, re-validating every time: the cookie only takes effect when the
 * real user is an admin AND it points to a real, non-admin retailer. A tampered/stale cookie is
 * simply ignored (treated as "not acting"), so it can never grant access the admin lacks.
 */
export async function getActingContext(): Promise<ActingContext> {
  const realUid = await getCurrentUserId();
  if (!realUid) return { realUid: null, isAdmin: false, actingAsId: null, retailer: null };

  const admin = await isAdmin(realUid);
  if (!admin) return { realUid, isAdmin: false, actingAsId: null, retailer: null };

  const target = (await cookies()).get(ACTING_COOKIE)?.value ?? null;
  if (!target || target === realUid) {
    return { realUid, isAdmin: true, actingAsId: null, retailer: null };
  }

  const profile = await getProfile(target);
  if (!profile || profile.role === "admin") {
    // Unknown / no-longer-valid / another admin → ignore the cookie.
    return { realUid, isAdmin: true, actingAsId: null, retailer: null };
  }

  return {
    realUid,
    isAdmin: true,
    actingAsId: target,
    retailer: { id: target, name: profile.company || profile.email },
  };
}

/** The owner_id new records should belong to: the acted-for retailer, else the real user. */
export async function getEffectiveOwnerId(): Promise<string | null> {
  const ctx = await getActingContext();
  return ctx.actingAsId ?? ctx.realUid;
}
