import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ChatThread } from "@/components/ChatThread";
import AdminInbox from "@/components/AdminInbox";
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
      <ChatThread role="retailer" conversationId={conv?.id ?? null} initialMessages={messages} />
    </>
  );
}
