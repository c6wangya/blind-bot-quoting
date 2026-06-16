import { DRAPERY_PRICING_V1, ROLLER_PRICING_V1, ROLLER_PRICING_V2 } from "@/lib/catalog-data";
import { computeQuote } from "@/lib/pricing";
import { admin } from "@/lib/supabase/admin";
import type { ItemConfig, OrderEventRow, OrderStatus } from "@/lib/types";
import { getLine, getProduct } from "./catalog";

// Demo seed — runs once per process, idempotent (inserts only when the tables are empty).

const DEMO_RETAILER = "Harbor & Lane Interiors";

let seedPromise: Promise<void> | null = null;
export function ensureSeeded(): Promise<void> {
  return (seedPromise ??= seed());
}

async function seed(): Promise<void> {
  const a = admin();

  const { count: pvCount } = await a
    .from("pricing_versions")
    .select("*", { count: "exact", head: true });
  if (!pvCount) {
    await a.from("pricing_versions").insert([
      { line_id: "roller-shade", version: "2026.1", active: false, note: "Initial FOB grid", config: ROLLER_PRICING_V1 },
      {
        line_id: "roller-shade",
        version: "2026.2",
        active: true,
        note: "Q2 freight adjustment: motorized +$5, blackout multiplier 1.28→1.30",
        config: ROLLER_PRICING_V2,
      },
      { line_id: "drapery", version: "2026.1", active: true, note: "Initial cut-and-make formula", config: DRAPERY_PRICING_V1 },
    ]);
  }

  const { count: qCount } = await a.from("quotes").select("*", { count: "exact", head: true });
  if (qCount) return;

  const mkQuote = async (
    ref: string,
    projectName: string,
    createdAt: string,
    status: "draft" | "converted",
    items: { productId: string; qty: number; config: ItemConfig }[]
  ): Promise<number> => {
    const { data: quote, error } = await a
      .from("quotes")
      .insert({ ref, retailer: DEMO_RETAILER, status, project_name: projectName, created_at: createdAt, updated_at: createdAt })
      .select("id")
      .single();
    if (error) throw error;
    const quoteId = (quote as { id: number }).id;
    const rows = items.map((it) => {
      const product = getProduct(it.productId)!;
      const line = getLine(product.lineId)!;
      const pricingCfg = product.lineId === "roller-shade" ? ROLLER_PRICING_V2 : DRAPERY_PRICING_V1;
      const version = product.lineId === "roller-shade" ? "2026.2" : "2026.1";
      const computation = computeQuote(line, product, it.config, pricingCfg, version);
      return {
        quote_id: quoteId,
        product_id: product.id,
        line_id: product.lineId,
        qty: it.qty,
        config: it.config,
        computation,
        created_at: createdAt,
      };
    });
    await a.from("quote_items").insert(rows);
    return quoteId;
  };

  const q1 = await mkQuote("Q-2026-0001", "Maple St. Townhomes — Unit 4B", "2026-05-12 09:14:00", "converted", [
    {
      productId: "rs-roller-shade",
      qty: 6,
      config: { colorId: "gray", opacityId: "privacy", options: { mount: "inside", control: "cordless", headrail: "white-cassette", sideChannel: "none" }, dimensions: { width: 120, height: 160 } },
    },
    {
      productId: "rs-roller-shade",
      qty: 2,
      config: { colorId: "charcoal", opacityId: "blackout", options: { mount: "outside", control: "motorized", headrail: "fascia", sideChannel: "black" }, dimensions: { width: 180, height: 210 } },
    },
  ]);

  const q2 = await mkQuote("Q-2026-0002", "Hotel Meridian — Floor 7 refresh", "2026-05-26 14:40:00", "converted", [
    {
      productId: "dp-standard-drapery",
      qty: 12,
      config: { colorId: "grey", opacityId: "blackout", options: { fullness: "2.5x", header: "ripplefold", liner: "blackout", control: "cord-draw", stack: "split", rodColor: "matte-black" }, dimensions: { rodWidth: 320, height: 260 } },
    },
    {
      productId: "dp-standard-drapery",
      qty: 12,
      config: { colorId: "white", opacityId: "sheer", options: { fullness: "3x", header: "ripplefold", liner: "unlined", control: "baton-draw", stack: "split", rodColor: "matte-black" }, dimensions: { rodWidth: 320, height: 258 } },
    },
  ]);

  const mkOrder = async (
    ref: string,
    quoteId: number,
    fields: Record<string, unknown>,
    events: [OrderStatus, string, OrderEventRow["actor"], string][]
  ) => {
    const { data: order, error } = await a
      .from("orders")
      .insert({ ref, quote_id: quoteId, ...fields })
      .select("id")
      .single();
    if (error) throw error;
    const orderId = (order as { id: number }).id;
    await a.from("order_events").insert(
      events.map(([status, note, actor, created_at]) => ({ order_id: orderId, status, note, actor, created_at }))
    );
  };

  await mkOrder(
    "PO-2026-0001",
    q1,
    { status: "delivered", supplier_order_no: "SZF-88217", tracking_no: "SF1029384756021", carrier: "SF Express Intl", eta_date: "2026-06-02", created_at: "2026-05-12 10:02:00", updated_at: "2026-06-02 16:21:00" },
    [
      ["submitted", "Pre-order PO-2026-0001 submitted. Supplier order file generated and queued for delivery.", "retailer", "2026-05-12 10:02:00"],
      ["acknowledged", "Supplier confirmed order — supplier order no. SZF-88217.", "supplier", "2026-05-13 03:12:00"],
      ["in_production", "Fabric cut and rolling started at Shenzhen facility.", "supplier", "2026-05-15 08:30:00"],
      ["shipped", "Shipment handed to SF Express Intl — tracking SF1029384756021.", "supplier", "2026-05-24 11:05:00"],
      ["in_transit", "Cleared export customs, in linehaul to destination.", "logistics", "2026-05-27 19:44:00"],
      ["delivered", "Delivered and signed for at receiving dock.", "logistics", "2026-06-02 16:21:00"],
    ]
  );

  await mkOrder(
    "PO-2026-0002",
    q2,
    { status: "in_production", supplier_order_no: "SZF-88341", eta_date: "2026-06-24", created_at: "2026-05-26 15:10:00", updated_at: "2026-06-01 07:55:00" },
    [
      ["submitted", "Pre-order PO-2026-0002 submitted. Supplier order file generated and queued for delivery.", "retailer", "2026-05-26 15:10:00"],
      ["acknowledged", "Supplier confirmed order — supplier order no. SZF-88341. ETA 2026-06-24.", "supplier", "2026-05-27 02:48:00"],
      ["in_production", "Cut-and-sew in progress — 12 of 24 panels complete.", "supplier", "2026-06-01 07:55:00"],
    ]
  );
}

export { DEMO_RETAILER };
