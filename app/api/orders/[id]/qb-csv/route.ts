import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { getOrder, getAccessoryDefaultPrices } from "@/lib/db";
import { buildInvoiceLines } from "@/lib/invoice";

// QuickBooks Online CSV export — the interim before a real OAuth integration. QBO's built-in
// invoice CSV import expects one row per line item with a shared InvoiceNo; importing this file
// recreates the order as a QBO invoice (customer auto-matched/created by name). Columns follow
// QBO's sample template. Escape per RFC 4180.

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const order = await getOrder(id);
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const q = order.quote;

    const lines = buildInvoiceLines(q.items, await getAccessoryDefaultPrices());
    const invoiceNo = order.ref;
    const customer = q.customerName || q.retailer || "Customer";
    const date = new Date(order.createdAt).toLocaleDateString("en-US");

    const header = [
      "InvoiceNo",
      "Customer",
      "InvoiceDate",
      "DueDate",
      "Item(Product/Service)",
      "ItemDescription",
      "ItemQuantity",
      "ItemRate",
      "ItemAmount",
    ];
    const rows = lines.map((l) =>
      [
        invoiceNo,
        customer,
        date,
        date,
        l.name,
        l.description,
        l.qty,
        l.rate.toFixed(2),
        l.amount.toFixed(2),
      ].map(csvCell)
    );
    // Shipping/tax/fees baked into the order amount beyond the goods subtotal land as one
    // adjustment row so the QBO invoice total matches what was actually charged.
    const goods = lines.reduce((s, l) => s + l.amount, 0);
    const extra = Math.round(((order.amount ?? goods) - goods) * 100) / 100;
    if (extra !== 0) {
      rows.push(
        [invoiceNo, customer, date, date, "Shipping & fees", "Freight, tax, and fees", 1, extra.toFixed(2), extra.toFixed(2)].map(
          csvCell
        )
      );
    }

    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${order.ref}_quickbooks.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
