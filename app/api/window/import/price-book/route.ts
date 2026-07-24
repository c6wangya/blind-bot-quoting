import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAdmin } from "@/lib/auth/api";
import { addPriceGrid, getDefaultOrgId, upsertPriceGroup } from "@/lib/db";

// A.5 — Excel price-book importer. The industry's admitted onboarding pain (all three
// competitors monetize catalog setup as a service); we make it self-serve: upload the
// supplier's workbook, auto-detect the W×H grids, assign each to a price group, done.
//
//   { action: "parse",  fileBase64 }                       → detected grid candidates per sheet
//   { action: "commit", grids: [{ groupKey, groupLabel?, widthBreaks, heightBreaks, cells, note? }] }
//                                                          → creates groups + grids

type DetectedGrid = {
  sheetName: string;
  anchor: string; // top-left cell of the detected header, e.g. "B3"
  widthBreaks: number[];
  heightBreaks: number[];
  cells: (number | null)[][];
};

const MAX_DIM = 60; // sanity cap on grid axes

function cellNumber(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || /^(n\/?a|-|—)$/i.test(s)) return null;
    const n = Number(s.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === "object" && "result" in v && typeof v.result === "number") return v.result; // formula cell
  return null;
}

function isBlankish(v: ExcelJS.CellValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "" || /^(n\/?a|-|—)$/i.test(v.trim());
  return false;
}

/**
 * Detect W×H grids on one sheet: a header row of ≥3 ascending-ish numbers with a numeric
 * column directly below-left (the height breaks), body numeric/blank. Scans for multiple
 * grids per sheet (the anchor's price sheets stack RSA..RSD vertically).
 */
function detectGrids(ws: ExcelJS.Worksheet): DetectedGrid[] {
  const grids: DetectedGrid[] = [];
  const maxRow = Math.min(ws.rowCount, 500);
  const maxCol = Math.min(ws.columnCount, 80);
  const val = (r: number, c: number): ExcelJS.CellValue => ws.getRow(r).getCell(c).value;
  const claimed = new Set<string>(); // rows already inside a detected grid

  for (let r = 1; r <= maxRow; r++) {
    if (claimed.has(`r${r}`)) continue;
    for (let c = 1; c <= maxCol; c++) {
      // candidate header run starting at (r, c+1): ≥3 consecutive numerics
      const widths: number[] = [];
      let cc = c + 1;
      while (cc <= maxCol && widths.length < MAX_DIM) {
        const n = cellNumber(val(r, cc));
        if (n === null) break;
        widths.push(n);
        cc++;
      }
      if (widths.length < 3) continue;
      // rows below with numeric in col c = height breaks
      const heights: number[] = [];
      const cells: (number | null)[][] = [];
      let rr = r + 1;
      while (rr <= maxRow && heights.length < MAX_DIM) {
        const h = cellNumber(val(rr, c));
        if (h === null) break;
        const row: (number | null)[] = [];
        let numeric = 0;
        for (let i = 0; i < widths.length; i++) {
          const v = val(rr, c + 1 + i);
          const n = cellNumber(v);
          if (n !== null) numeric++;
          else if (!isBlankish(v)) { numeric = -1; break; } // junk text = not a grid row
          row.push(n);
        }
        if (numeric < Math.ceil(widths.length / 2)) break; // require a mostly-numeric body row
        heights.push(h);
        cells.push(row);
        rr++;
      }
      if (heights.length < 2) continue;

      // normalize both axes ascending (sheets are often authored descending)
      const wOrder = widths.map((_, i) => i).sort((a, b) => widths[a] - widths[b]);
      const hOrder = heights.map((_, i) => i).sort((a, b) => heights[a] - heights[b]);
      grids.push({
        sheetName: ws.name,
        anchor: ws.getRow(r).getCell(c).address,
        widthBreaks: wOrder.map((i) => widths[i]),
        heightBreaks: hOrder.map((i) => heights[i]),
        cells: hOrder.map((hi) => wOrder.map((wi) => cells[hi][wi])),
      });
      for (let cr = r; cr < rr; cr++) claimed.add(`r${cr}`);
      break; // continue scanning after this grid's rows
    }
  }
  return grids;
}

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json();

    if (body.action === "parse") {
      if (typeof body.fileBase64 !== "string" || !body.fileBase64) {
        return NextResponse.json({ error: "fileBase64 is required" }, { status: 400 });
      }
      const buf = Buffer.from(body.fileBase64, "base64");
      if (buf.length > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large (15MB max)" }, { status: 400 });
      }
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const grids: DetectedGrid[] = [];
      for (const ws of wb.worksheets) {
        if (ws.state && ws.state !== "visible") continue; // skip hidden calc sheets by default
        grids.push(...detectGrids(ws));
      }
      // hidden sheets often hold the real price tables (the anchor's do) — include them
      // separately flagged so the admin can opt in.
      const hidden: DetectedGrid[] = [];
      for (const ws of wb.worksheets) {
        if (!ws.state || ws.state === "visible") continue;
        hidden.push(...detectGrids(ws));
      }
      return NextResponse.json({ grids, hiddenGrids: hidden });
    }

    if (body.action === "commit") {
      const grids = Array.isArray(body.grids) ? body.grids : [];
      if (!grids.length) return NextResponse.json({ error: "No grids to import" }, { status: 400 });
      const orgId = await getDefaultOrgId();
      const results: { groupKey: string; gridId: number }[] = [];
      for (const g of grids) {
        const key = String(g.groupKey ?? "").trim();
        if (!key) return NextResponse.json({ error: "Each grid needs a groupKey" }, { status: 400 });
        const widths = (g.widthBreaks ?? []).map(Number);
        const heights = (g.heightBreaks ?? []).map(Number);
        const cells = g.cells;
        if (widths.length < 2 || heights.length < 2 || !Array.isArray(cells)) {
          return NextResponse.json({ error: `Grid "${key}" is malformed` }, { status: 400 });
        }
        const group = await upsertPriceGroup(orgId, { key, label: g.groupLabel });
        const grid = await addPriceGrid(orgId, {
          priceGroupId: group.id,
          widthBreaks: widths,
          heightBreaks: heights,
          cells,
          note: g.note ?? `imported from ${g.sheetName ?? "workbook"}`,
        });
        results.push({ groupKey: key, gridId: grid.id });
      }
      return NextResponse.json({ imported: results }, { status: 201 });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
