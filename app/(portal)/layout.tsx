import PortalShell from "@/components/PortalShell";
import { getCurrentUserId, userClient } from "@/lib/auth/user";
import { getAdminPendingCount, getDraftQuote, getProfile, getQuote, getUnreadCount } from "@/lib/db";

// Every portal page reads live DB state; opt this subtree out of static prerendering.
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const ownerId = await getCurrentUserId();
  const sb = ownerId ? await userClient() : undefined;
  const draft = ownerId ? await getDraftQuote(ownerId, sb) : undefined;
  const draftCount = draft ? (await getQuote(draft.id, sb))?.items.length ?? 0 : 0;

  const profile = ownerId ? await getProfile(ownerId) : null;
  const accountName = profile?.company || profile?.email || "Guest";
  const accountSub = profile ? (profile.company ? profile.email : "Retailer account") : "Not signed in";
  const isAdmin = profile?.role === "admin";
  const unreadCount = ownerId ? await getUnreadCount(ownerId, isAdmin) : 0;
  const supplierPendingCount = isAdmin ? await getAdminPendingCount() : 0;

  return (
    <PortalShell
      draftCount={draftCount}
      unreadCount={unreadCount}
      supplierPendingCount={supplierPendingCount}
      accountName={accountName}
      accountSub={accountSub}
      signedIn={!!ownerId}
      isAdmin={isAdmin}
    >
      {children}
    </PortalShell>
  );
}
