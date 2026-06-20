import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/api";
import { getAdminPendingCount } from "@/lib/db";

/** Count of orders needing admin action (Supplier Console badge). Admin only. */
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ count: await getAdminPendingCount(admin()) });
}
