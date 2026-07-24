import PortalShell from "@/components/PortalShell";
import { mustChangePassword, userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import {
  getAdminPendingCount,
  getDraftCount,
  getProfile,
  getUnreadCount,
  listRetailers,
  windowDealerAccessFor,
} from "@/lib/db";

// Every portal page reads live DB state; opt this subtree out of static prerendering.
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const ctx = await getActingContext();
  const realUid = ctx.realUid;
  // While acting, the sidebar draft + quote views reflect the acted-for retailer; service_role
  // bypasses RLS for the cross-owner reads. Otherwise the retailer's own RLS-scoped client.
  const effectiveOwner = ctx.actingAsId ?? realUid;
  const sb = realUid ? (ctx.actingAsId ? admin() : await userClient()) : undefined;
  const draftCount = effectiveOwner ? await getDraftCount(effectiveOwner, sb) : 0;

  // Account chrome always shows the REAL signed-in user — acting-on-behalf is not impersonation.
  const profile = realUid ? await getProfile(realUid) : null;
  const accountName = profile?.company || profile?.email || "Guest";
  const accountSub = profile ? (profile.company ? profile.email : "Retailer account") : "Not signed in";
  const isAdmin = ctx.isAdmin;
  const unreadCount = realUid ? await getUnreadCount(realUid, isAdmin) : 0;
  const supplierPendingCount = isAdmin ? await getAdminPendingCount() : 0;
  const retailers = isAdmin ? await listRetailers() : [];
  const nudgePassword = realUid ? await mustChangePassword() : false;
  // Window Catalog nav for dealer users — only after the org flips dealerWindowAccess on.
  // Fail-quiet: a broken flag lookup must never take down the whole portal chrome.
  const windowCatalog =
    realUid && !isAdmin ? await windowDealerAccessFor(realUid).then((v) => v != null, () => false) : false;

  return (
    <PortalShell
      draftCount={draftCount}
      unreadCount={unreadCount}
      supplierPendingCount={supplierPendingCount}
      accountName={accountName}
      accountSub={accountSub}
      signedIn={!!realUid}
      isAdmin={isAdmin}
      retailers={retailers}
      actingAsId={ctx.actingAsId}
      nudgePassword={nudgePassword}
      windowCatalog={windowCatalog}
    >
      {children}
    </PortalShell>
  );
}
