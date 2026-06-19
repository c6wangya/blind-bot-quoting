import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { getCurrentUserId, isAdmin, userClient } from "@/lib/auth/user";
import { CHAT_BUCKET, getOrCreateConversationForRetailer, sendAttachmentMessage } from "@/lib/db";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DOC_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
const allowed = (type: string) => type.startsWith("image/") || DOC_TYPES.includes(type);

/** Upload a chat attachment (image/file) to the private bucket and post it as a message. */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    const caption = String(form.get("caption") ?? "");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!allowed(file.type)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be ≤ 10 MB" }, { status: 400 });

    const adminUser = await isAdmin(uid);
    let conversationId: string;
    let sb;
    if (adminUser) {
      const cid = form.get("conversationId");
      if (typeof cid !== "string" || !cid) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
      conversationId = cid;
      sb = admin();
    } else {
      sb = await userClient();
      conversationId = (await getOrCreateConversationForRetailer(uid, sb)).id;
    }

    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin().storage.from(CHAT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      const msg = /bucket/i.test(upErr.message)
        ? `Storage bucket "${CHAT_BUCKET}" not found — create it (private) in Supabase first.`
        : upErr.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const message = await sendAttachmentMessage(
      conversationId,
      uid,
      adminUser ? "admin" : "retailer",
      { path, name: file.name, type: file.type, size: file.size },
      caption,
      sb
    );
    return NextResponse.json({ conversationId, message });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
