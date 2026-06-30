import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { syncBlindbotClients } from "@/lib/auth/sync-clients";

/** Provision blind-bot `clients` retailers missing from quoting (auth + profile). Admin only. */
export async function POST() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await syncBlindbotClients();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
