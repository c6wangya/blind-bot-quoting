import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { listWindowTemplates } from "@/lib/db";

/** Published window-product templates (latest revision per line). Admin only (v1: the whole
 *  window ERP surface is admin-gated so live retailer flows are untouched). */
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    return NextResponse.json(await listWindowTemplates());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
