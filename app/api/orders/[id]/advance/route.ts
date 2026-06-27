import { NextResponse } from "next/server";
import { getCurrentUserId, isAdmin } from "@/lib/auth/user";
import { getOrder, updateOrder } from "@/lib/db";
import type { OrderStatus } from "@/lib/types";

/**
 * Simulates the supplier / logistics side of the pipeline: each action is what
 * the real integration would receive from the China supplier's system or the
 * logistics layer (order numbers, tracking numbers, status pushes).
 */
const FLOW: Record<string, OrderStatus> = {
  acknowledge: "acknowledged",
  start_production: "in_production",
  ship: "shipped",
  in_transit: "in_transit",
  deliver: "delivered",
};

// Two pipelines share the machine: PRODUCT orders run all 6 steps; ACCESSORY-only orders collapse
// to submitted → acknowledged → shipped. The only difference is what `ship` follows.
const PRECONDITION = (accessoryOnly: boolean): Record<string, OrderStatus> => ({
  acknowledge: "submitted",
  start_production: "acknowledged",
  ship: accessoryOnly ? "acknowledged" : "in_production",
  in_transit: "shipped",
  deliver: "in_transit",
});

const rand = (len: number) => {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orderId = Number(id);
  const order = await getOrder(orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const body = (await req.json()) as { action: string; carrier?: string; trackingNos?: string[] };
  const { action } = body;
  const next = FLOW[action];
  if (!next) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (order.status !== PRECONDITION(order.accessoryOnly)[action]) {
    return NextResponse.json(
      { error: `Order is "${order.status}" — cannot ${action.replace("_", " ")}` },
      { status: 409 }
    );
  }

  switch (action) {
    case "acknowledge": {
      const supplierOrderNo = `SZF-${rand(5)}`;
      const eta = new Date();
      eta.setDate(eta.getDate() + 21);
      const etaDate = eta.toISOString().slice(0, 10);
      await updateOrder(
        orderId,
        { status: next, supplierOrderNo, etaDate },
        {
          status: next,
          note: `Supplier confirmed order — supplier order no. ${supplierOrderNo}. ETA ${etaDate}.`,
          actor: "supplier",
        }
      );
      break;
    }
    case "start_production":
      await updateOrder(
        orderId,
        { status: next },
        { status: next, note: "Production started — fabric cutting and assembly underway.", actor: "supplier" }
      );
      break;
    case "ship": {
      // Accessory orders ship with admin-entered tracking number(s); product orders keep the
      // simulated auto-issued tracking number.
      let trackingNo: string;
      let trackingNos: string[] | null = null;
      let carrier: string;
      if (order.accessoryOnly) {
        const nums = (body.trackingNos ?? []).map((s) => s.trim()).filter(Boolean);
        if (nums.length === 0) {
          return NextResponse.json({ error: "Enter at least one tracking number." }, { status: 400 });
        }
        carrier = (body.carrier ?? "").trim() || "SF Express Intl";
        trackingNo = nums[0];
        trackingNos = nums;
      } else {
        trackingNo = `SF${rand(13)}`;
        carrier = "SF Express Intl";
      }
      await updateOrder(
        orderId,
        { status: next, trackingNo, trackingNos, carrier },
        {
          status: next,
          note: `Shipment handed to ${carrier} — tracking ${(trackingNos ?? [trackingNo]).join(", ")}. Synced to logistics layer.`,
          actor: "supplier",
        }
      );
      break;
    }
    case "in_transit":
      await updateOrder(
        orderId,
        { status: next },
        { status: next, note: "Cleared export customs, in linehaul to destination market.", actor: "logistics" }
      );
      break;
    case "deliver":
      await updateOrder(
        orderId,
        { status: next },
        { status: next, note: "Delivered and signed for at receiving dock.", actor: "logistics" }
      );
      break;
  }

  return NextResponse.json({ order: await getOrder(orderId) });
}
