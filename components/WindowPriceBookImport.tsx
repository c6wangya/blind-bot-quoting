"use client";

import { useState } from "react";
import { Button, Card, Input, cx } from "./ui";

// A.5 — self-serve price-book import: upload the supplier workbook, review the auto-detected
// W×H grids, name a price group for each you want, import. Detection is heuristic; anything
// it misses can still be pasted per-group in the product pricing tab.

type Detected = {
  sheetName: string;
  anchor: string;
  widthBreaks: number[];
  heightBreaks: number[];
  cells: (number | null)[][];
  hidden?: boolean;
};

export default function WindowPriceBookImport() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [grids, setGrids] = useState<Detected[]>([]);
  const [groupKeys, setGroupKeys] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<"parse" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy("parse");
    setError(null);
    setDone(null);
    setGrids([]);
    setGroupKeys({});
    try {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const res = await fetch("/api/window/import/price-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", fileBase64: btoa(bin) }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? "Parse failed");
      const all: Detected[] = [
        ...(out.grids ?? []),
        ...(out.hiddenGrids ?? []).map((g: Detected) => ({ ...g, hidden: true })),
      ];
      if (all.length === 0) {
        setError("No W×H grids detected. You can still paste grids manually in a product's Pricing tab.");
      }
      setGrids(all);
      setFileName(file.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    const selected = grids
      .map((g, i) => ({ g, key: (groupKeys[i] ?? "").trim() }))
      .filter((x) => x.key);
    if (!selected.length) return;
    setBusy("commit");
    setError(null);
    try {
      const res = await fetch("/api/window/import/price-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          grids: selected.map(({ g, key }) => ({
            groupKey: key,
            widthBreaks: g.widthBreaks,
            heightBreaks: g.heightBreaks,
            cells: g.cells,
            sheetName: g.sheetName,
            note: `imported from ${fileName ?? "workbook"} · ${g.sheetName}!${g.anchor}`,
          })),
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? "Import failed");
      setDone(`Imported ${out.imported.length} grid(s): ${out.imported.map((r: { groupKey: string }) => r.groupKey).join(", ")}`);
      setGrids([]);
      setGroupKeys({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <Card className="p-5">
        <div className="text-sm font-semibold text-ink">Upload a price book (.xlsx)</div>
        <p className="mt-1 text-xs text-muted">
          W×H price matrices are detected automatically (first row = widths, first column = heights, blank/N/A =
          not manufacturable). Assign a price group key to each grid you want to import — existing groups get a
          new grid revision, old ones stay for order history.
        </p>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          className="mt-3 block text-sm text-ink-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        {busy === "parse" && <div className="mt-2 text-xs text-muted">Parsing workbook…</div>}
        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
        {done && <div className="mt-2 text-xs text-emerald-700">{done} ✓</div>}
      </Card>

      {grids.length > 0 && (
        <>
          {grids.map((g, i) => (
            <Card key={i} className={cx("p-5", !groupKeys[i]?.trim() && "opacity-80")}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">
                    {g.sheetName} <span className="font-normal text-muted">@ {g.anchor}</span>
                    {g.hidden && (
                      <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
                        hidden sheet
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {g.widthBreaks.length} widths ({g.widthBreaks[0]}–{g.widthBreaks.at(-1)}″) ×{" "}
                    {g.heightBreaks.length} heights ({g.heightBreaks[0]}–{g.heightBreaks.at(-1)}″)
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-muted">
                  Import as group
                  <Input
                    value={groupKeys[i] ?? ""}
                    onChange={(e) => setGroupKeys((k) => ({ ...k, [i]: e.target.value }))}
                    placeholder="e.g. RSA"
                    className="w-28"
                  />
                </label>
              </div>
              {/* compact preview: corners of the matrix */}
              <div className="mt-3 overflow-x-auto">
                <table className="text-[11px] tabular-nums text-ink-soft">
                  <thead>
                    <tr>
                      <th className="pr-3 text-left font-semibold text-muted">H\W</th>
                      {g.widthBreaks.slice(0, 6).map((w) => (
                        <th key={w} className="px-2 text-right font-semibold text-muted">
                          {w}
                        </th>
                      ))}
                      {g.widthBreaks.length > 6 && <th className="px-2 text-muted">…</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.heightBreaks.slice(0, 4).map((h, hi) => (
                      <tr key={h}>
                        <td className="pr-3 font-semibold text-muted">{h}</td>
                        {g.cells[hi].slice(0, 6).map((c, ci) => (
                          <td key={ci} className="px-2 text-right">
                            {c === null ? "—" : c}
                          </td>
                        ))}
                        {g.widthBreaks.length > 6 && <td className="px-2">…</td>}
                      </tr>
                    ))}
                    {g.heightBreaks.length > 4 && (
                      <tr>
                        <td className="text-muted">…</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <div className="flex justify-end">
            <Button onClick={commit} disabled={busy !== null || !Object.values(groupKeys).some((k) => k.trim())}>
              {busy === "commit"
                ? "Importing…"
                : `Import ${Object.values(groupKeys).filter((k) => k.trim()).length} grid(s)`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
