import Sidebar from "@/components/Sidebar";
import { getCurrentUserId } from "@/lib/auth/user";
import { getDraftQuote, getQuote } from "@/lib/db";

// Every portal page reads live DB state; opt this subtree out of static prerendering.
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const ownerId = await getCurrentUserId();
  const draft = ownerId ? await getDraftQuote(ownerId) : undefined;
  const draftCount = draft ? (await getQuote(draft.id))?.items.length ?? 0 : 0;

  return (
    <>
      <Sidebar draftCount={draftCount} />
      <main className="ml-60 min-h-screen">
        <div className="mx-auto max-w-6xl px-8 py-10">{children}</div>
      </main>
    </>
  );
}
