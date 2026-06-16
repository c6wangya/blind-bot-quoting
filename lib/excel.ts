import ExcelJS from "exceljs";
import { BRAND } from "./brand";
import { OPACITY_LABELS } from "./catalog-data";
import { getLine, getOrder, getProduct } from "./db";
import { isAccessoryConfig } from "./types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2A44" },
};
const BAND_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF3F1EC" },
};
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFB8B5AD" } },
  bottom: { style: "thin", color: { argb: "FFB8B5AD" } },
  left: { style: "thin", color: { argb: "FFB8B5AD" } },
  right: { style: "thin", color: { argb: "FFB8B5AD" } },
};

/**
 * Builds the pre-order workbook in the bilingual format the China supplier
 * ingests: one header block + one row per quote line, with manufacturing
 * facts (fabric meters, panel counts) precomputed.
 */
export async function buildOrderWorkbook(orderId: number): Promise<{ buffer: Buffer; filename: string }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");

  const wb = new ExcelJS.Workbook();
  wb.creator = `${BRAND.name} ${BRAND.tagline}`;
  const ws = wb.addWorksheet("订单 Order", {
    pageSetup: { orientation: "landscape", fitToPage: true },
  });

  ws.columns = [
    { width: 6 }, { width: 16 }, { width: 12 }, { width: 18 }, { width: 14 },
    { width: 16 }, { width: 12 }, { width: 12 }, { width: 26 }, { width: 30 },
    { width: 8 }, { width: 12 }, { width: 24 },
  ];

  // ---- header block ----
  ws.mergeCells("A1:M1");
  const title = ws.getCell("A1");
  title.value = `预订单 PRE-ORDER — ${BRAND.name}`;
  title.font = { size: 16, bold: true, color: { argb: "FF1F2A44" } };
  ws.getRow(1).height = 26;

  const meta: [string, string][] = [
    ["订单号 PO Ref", order.ref],
    ["报价单号 Quote Ref", order.quote.ref],
    ["零售商 Retailer", order.quote.retailer],
    ["项目 Project", order.quote.projectName ?? "—"],
    ["下单日期 Order Date", order.createdAt.slice(0, 10)],
    ["币种 Currency", "USD"],
  ];
  meta.forEach(([k, v], i) => {
    const row = ws.getRow(3 + i);
    row.getCell(1).value = k;
    ws.mergeCells(3 + i, 1, 3 + i, 2);
    row.getCell(1).font = { bold: true, color: { argb: "FF6B6A66" } };
    row.getCell(3).value = v;
    ws.mergeCells(3 + i, 3, 3 + i, 5);
  });

  // ---- line items ----
  const headerRowIdx = 10;
  const headers = [
    "序号\nNo.",
    "产品线\nProduct Line",
    "型号\nSKU",
    "花色\nPattern",
    "颜色\nColor",
    "遮光度\nOpacity",
    "宽 (cm)\nWidth",
    "高 (cm)\nHeight",
    "选项\nOptions",
    "工艺参数\nMfg. Facts",
    "数量\nQty",
    "单价\nUnit (USD)",
    "备注\nRemarks",
  ];
  const headerRow = ws.getRow(headerRowIdx);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = thin;
  });
  headerRow.height = 30;

  order.quote.items.forEach((item, idx) => {
    const factsText = item.computation.facts.map((f) => `${f.label}: ${f.value}`).join("\n");
    const row = ws.getRow(headerRowIdx + 1 + idx);

    let values: (string | number)[];
    if (isAccessoryConfig(item.config)) {
      // Accessory (A-OK motor): no pattern/color/dimensions/options.
      const cfg = item.config;
      values = [idx + 1, cfg.category, cfg.sku, cfg.name, "—", "—", "", "", `Brand: ${cfg.brand}`, factsText, item.qty, item.computation.unitPrice, ""];
    } else {
      const product = getProduct(item.productId)!;
      const line = getLine(item.lineId as string)!;
      const cfg = item.config;
      const color = product.colors.find((c) => c.id === cfg.colorId);
      const width = cfg.dimensions.width ?? cfg.dimensions.rodWidth ?? 0;
      const height = cfg.dimensions.height ?? 0;
      const optionText = line.optionGroups
        .map((g) => {
          const picked = g.options.find((o) => o.id === cfg.options[g.key]);
          return picked ? `${g.label}: ${picked.name}` : null;
        })
        .filter(Boolean)
        .join("\n");
      values = [
        idx + 1,
        line.name,
        product.sku,
        product.name,
        color?.name ?? cfg.colorId,
        OPACITY_LABELS[cfg.opacityId],
        width,
        height,
        optionText,
        factsText,
        item.qty,
        item.computation.unitPrice,
        "",
      ];
    }
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.border = thin;
      cell.alignment = { wrapText: true, vertical: "top" };
      if (idx % 2 === 1) cell.fill = BAND_FILL;
    });
    row.getCell(12).numFmt = '"$"#,##0.00';
  });

  // ---- totals ----
  const totalRowIdx = headerRowIdx + order.quote.items.length + 2;
  const totalRow = ws.getRow(totalRowIdx);
  totalRow.getCell(10).value = "合计 Total";
  totalRow.getCell(10).font = { bold: true };
  totalRow.getCell(11).value = order.quote.items.reduce((s, i) => s + i.qty, 0);
  totalRow.getCell(11).font = { bold: true };
  totalRow.getCell(12).value = order.quote.total;
  totalRow.getCell(12).numFmt = '"$"#,##0.00';
  totalRow.getCell(12).font = { bold: true };

  // ---- instructions sheet ----
  const info = wb.addWorksheet("说明 Instructions");
  info.columns = [{ width: 100 }];
  [
    `1. 本预订单由 ${BRAND.name} 自动生成。 This pre-order was generated automatically by ${BRAND.name}.`,
    "2. 请在确认后回传供应商订单号。 Please return the supplier order number upon confirmation.",
    "3. 发货后请提供运单号以同步物流状态。 Provide the tracking number at dispatch so logistics status can sync.",
    "4. 所有尺寸为成品尺寸，单位厘米。 All dimensions are finished sizes, in centimeters.",
  ].forEach((t, i) => {
    info.getCell(`A${i + 1}`).value = t;
    info.getCell(`A${i + 1}`).alignment = { wrapText: true };
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${order.ref}_${BRAND.slug}_PreOrder.xlsx` };
}
