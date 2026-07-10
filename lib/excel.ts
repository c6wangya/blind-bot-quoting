import ExcelJS from "exceljs";
import { BRAND } from "./brand";
import { getOrder } from "./db";
import { brandOfItem, buildPurchaseOrderDoc, type PurchaseOrderDoc } from "./purchase-order";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF3A3A3A" },
};
const BAND_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF3F1EC" },
};
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD9D6CE" } },
  bottom: { style: "thin", color: { argb: "FFD9D6CE" } },
  left: { style: "thin", color: { argb: "FFD9D6CE" } },
  right: { style: "thin", color: { argb: "FFD9D6CE" } },
};
const MONEY = '"$"#,##0.00';
const CENTER = { horizontal: "center", vertical: "middle" } as const;

/** Excel sheet names can't contain []:*?/\ and are capped at 31 chars; keep them unique. */
function sheetName(brand: string, used: Set<string>): string {
  const base = (brand.replace(/[[\]*?/\\:]/g, " ").trim().slice(0, 28) || "PO");
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base} ${n++}`.slice(0, 31);
  used.add(name);
  return name;
}

/** Render one brand's PO doc onto a worksheet — the Excel twin of the printable PO page. */
function addPurchaseOrderSheet(wb: ExcelJS.Workbook, doc: PurchaseOrderDoc, orderRef: string, name: string) {
  const ws = wb.addWorksheet(name, { pageSetup: { orientation: "portrait", fitToPage: true } });
  ws.columns = [{ width: 6 }, { width: 24 }, { width: 44 }, { width: 10 }, { width: 12 }, { width: 14 }];

  // ---- supplier banner (rows 1-4, merged across A:F) ----
  const banner = (r: number, value: string, font: Partial<ExcelJS.Font>) => {
    ws.mergeCells(`A${r}:F${r}`);
    const c = ws.getCell(`A${r}`);
    c.value = value;
    c.font = font;
    c.alignment = CENTER;
  };
  const sup = doc.supplier;
  banner(1, doc.supplierName, { size: 14, bold: true });
  ws.getRow(1).height = 22;
  banner(2, sup?.addressLines.length ? `ADD: ${sup.addressLines.join(", ")}` : "", {});
  banner(
    3,
    sup ? [sup.tel && `Tel: ${sup.tel}`, sup.fax && `Fax: ${sup.fax}`, sup.website].filter(Boolean).join("      ") : "",
    {}
  );
  banner(4, "PURCHASE ORDER", { size: 16, bold: true });
  ws.getRow(4).height = 24;

  // ---- buyer block (left) + invoice meta (right), rows 5-8 ----
  const metaVal = (k: string) => doc.meta.find((m) => m[0] === k)?.[1] ?? "";
  const kv = (r: number, aLabel: string, bVal: string, dLabel?: string, eVal?: string) => {
    ws.getCell(`A${r}`).value = aLabel;
    ws.getCell(`A${r}`).font = { bold: true, color: { argb: "FF6B6A66" } };
    ws.mergeCells(`B${r}:C${r}`);
    ws.getCell(`B${r}`).value = bVal;
    if (dLabel != null) {
      ws.getCell(`D${r}`).value = dLabel;
      ws.getCell(`D${r}`).font = { bold: true, color: { argb: "FF6B6A66" } };
      ws.mergeCells(`E${r}:F${r}`);
      ws.getCell(`E${r}`).value = eVal ?? "";
    }
  };
  kv(5, "Buyer:", doc.buyerName, "Date:", metaVal("Date"));
  kv(6, "Attn:", doc.buyer.attn, "Order No.:", orderRef);
  kv(7, "Address:", doc.buyer.addressLines.join(", "), "Currency:", metaVal("Currency"));
  kv(8, "Tel:", [doc.buyer.tel, doc.buyer.email].filter(Boolean).join("   "));

  // ---- parts table header (row 10) ----
  const H = 10;
  const headers = ["Item", "Part No.", "Description", "Qty", "Unit Price", "Amount"];
  const hr = ws.getRow(H);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.fill = HEADER_FILL;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: i >= 3 ? "right" : i === 0 ? "center" : "left", vertical: "middle" };
    c.border = thin;
  });
  hr.height = 20;

  // ---- item rows ----
  let r = H;
  let itemNo = 0;
  for (const row of doc.rows) {
    r++;
    if (!row.sub) itemNo++;
    const desc = (row.sub ? "↳ " : "") + row.name + (row.detail ? `\n${row.detail}` : "");
    const values: ExcelJS.CellValue[] = [row.sub ? "" : itemNo, row.sku ?? "", desc, row.qty, row.rate, row.amount];
    const rr = ws.getRow(r);
    values.forEach((v, i) => {
      const c = rr.getCell(i + 1);
      c.value = v;
      c.border = thin;
      c.alignment = { wrapText: true, vertical: "top", horizontal: i >= 3 ? "right" : i === 0 ? "center" : "left" };
    });
    rr.getCell(5).numFmt = MONEY;
    rr.getCell(6).numFmt = MONEY;
  }

  // ---- total ----
  r++;
  ws.mergeCells(`A${r}:E${r}`);
  const totLabel = ws.getCell(`A${r}`);
  totLabel.value = "Total Amount";
  totLabel.font = { bold: true };
  totLabel.alignment = { horizontal: "right" };
  totLabel.fill = BAND_FILL;
  const totVal = ws.getCell(`F${r}`);
  totVal.value = doc.total;
  totVal.font = { bold: true };
  totVal.numFmt = MONEY;
  totVal.fill = BAND_FILL;

  // ---- supplier bank details ----
  if (doc.bank.length) {
    r += 2;
    ws.mergeCells(`A${r}:F${r}`);
    ws.getCell(`A${r}`).value = "Bank Information";
    ws.getCell(`A${r}`).font = { bold: true };
    for (const [k, v] of doc.bank) {
      r++;
      ws.mergeCells(`A${r}:B${r}`);
      ws.getCell(`A${r}`).value = k;
      ws.getCell(`A${r}`).font = { color: { argb: "FF6B6A66" } };
      ws.mergeCells(`C${r}:F${r}`);
      ws.getCell(`C${r}`).value = v;
    }
  }
}

/**
 * Builds the supplier purchase-order workbook — one Commercial-Invoice-style sheet per brand in the
 * order (supplier banner + our buyer block + parts table + total + supplier bank). Pass `brand` to
 * emit just that brand's sheet (matches the printable per-brand PO page exactly); omit it for the
 * whole order (one sheet per brand).
 */
export async function buildOrderWorkbook(orderId: number, brand?: string): Promise<{ buffer: Buffer; filename: string }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");

  // Brands present, in first-seen order.
  const brands: string[] = [];
  for (const it of order.quote.items) {
    const b = brandOfItem(it);
    if (!brands.includes(b)) brands.push(b);
  }
  const targets = brand ? brands.filter((b) => b === brand) : brands;
  if (targets.length === 0) throw new Error("No lines for the requested brand");

  const wb = new ExcelJS.Workbook();
  wb.creator = `${BRAND.name} ${BRAND.tagline}`;
  const used = new Set<string>();
  for (const b of targets) {
    const doc = await buildPurchaseOrderDoc(order, b);
    if (doc) addPurchaseOrderSheet(wb, doc, order.ref, sheetName(b, used));
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const suffix = brand ? `_${brand.replace(/[^a-z0-9-]+/gi, "-")}` : "";
  return { buffer, filename: `${order.ref}${suffix}_PO.xlsx` };
}
