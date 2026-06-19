import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ChatThread } from "@/components/ChatThread";
import AdminInbox from "@/components/AdminInbox";
import { BRAND } from "@/lib/brand";
import { getCurrentUserId, isAdmin, userClient } from "@/lib/auth/user";
import { getConversationForRetailer, getMessages, listConversations } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login?next=/messages");

  if (await isAdmin(uid)) {
    const conversations = await listConversations();
    return (
      <>
        <PageHeader
          eyebrow="Admin Console"
          title="Messages"
          description="Support conversations with retailers — pick one to read and reply."
        />
        <AdminInbox initialConversations={conversations} />
      </>
    );
  }

  const sb = await userClient();
  const conv = await getConversationForRetailer(uid, sb);
  const messages = conv ? await getMessages(conv.id, sb) : [];
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Messages"
        description="Chat with our team about products, pricing, and orders — we'll reply here."
      />
      <ChatThread
        role="retailer"
        conversationId={conv?.id ?? null}
        initialMessages={messages}
        initialPeerReadAt={conv?.adminLastReadAt ?? null}
        peerName={`${BRAND.name} Support`}
        peerSupport
        header={
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brass to-[#8a6a39] text-[12px] font-bold text-white">
              {BRAND.monogram}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{BRAND.name} Support</div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Typically replies within a few hours
              </div>
            </div>
          </div>
        }
      />
    </>
  );
}
