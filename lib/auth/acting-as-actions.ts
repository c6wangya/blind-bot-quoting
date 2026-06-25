"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUserId, isAdmin } from "@/lib/auth/user";
import { getProfile } from "@/lib/db";
import { ACTING_COOKIE } from "@/lib/auth/acting-as";

/**
 * Enter (or leave, with `null`) a retailer's "act-on-behalf-of" context. Admin-only and
 * re-validated server-side: a non-admin caller or an invalid/admin target is rejected, so this
 * can't be used to escalate. Revalidates the layout so the switcher banner + owner-scoped views
 * refresh immediately.
 */
export async function setActingAs(retailerId: string | null): Promise<void> {
  const uid = await getCurrentUserId();
  if (!uid || !(await isAdmin(uid))) throw new Error("Forbidden");

  const store = await cookies();
  if (!retailerId) {
    store.delete(ACTING_COOKIE);
  } else {
    const profile = await getProfile(retailerId);
    if (!profile || profile.role === "admin") throw new Error("Invalid retailer");
    store.set(ACTING_COOKIE, retailerId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }
  revalidatePath("/", "layout");
}
