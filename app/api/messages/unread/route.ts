import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { getCurrentUserId, isAdmin, userClient } from "@/lib/auth/user";
import { getUnreadCount } from "@/lib/db";

/** Unread badge count for the signed-in user (polled by the sidebar). */
export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ count: 0 });
  const adminUser = await isAdmin(uid);
  const sb = adminUser ? admin() : await userClient();
  return NextResponse.json({ count: await getUnreadCount(uid, adminUser, sb) });
}
