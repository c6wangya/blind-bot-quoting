import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/api";
import { listConversations } from "@/lib/db";

/** Admin inbox list (polled to keep previews/unread fresh). Admin only. */
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ conversations: await listConversations(admin()) });
}
