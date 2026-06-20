import { NextResponse } from "next/server";
import { requireOrderAccess } from "@/lib/auth/api";
import { getOrder } from "@/lib/db";

const MARKER = "reported the bank transfer";

/** Retailer signals they've sent the wire — records an event for the admin to verify & confirm. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrderAccess(ctx);
  if (gate instanceof NextResponse) return gate;
  const { id, sb } = gate;
  const order = await getOrder(id, sb);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "awaiting_payment" || order.paymentMethod !== "bank_transfer") {
    return NextResponse.json({ error: "Not awaiting a bank transfer" }, { status: 400 });
  }
  if (order.events?.some((e) => e.note.includes(MARKER))) return NextResponse.json({ ok: true }); // already reported
  const { error } = await sb.from("order_events").insert({
    order_id: id,
    status: "note",
    actor: "retailer",
    note: "Retailer reported the bank transfer as sent — awaiting confirmation.",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
