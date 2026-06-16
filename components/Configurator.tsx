"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TIER_LABELS } from "@/lib/catalog-data";
import { usd } from "@/lib/format";
import { mapImportedConfig, type ImportPayload } from "@/lib/import";
import type {
  ItemConfig,
  OpacityId,
  Product,
  ProductLine,
  QuoteComputation,
} from "@/lib/types";
import { Badge, Card, cx } from "./ui";

const DEFAULT_DIMS: Record<string, Record<string, number>> = {
  "roller-shade": { width: 150, height: 180 },
  drapery: { rodWidth: 280, height: 250 },
};

export default function Configurator({
  product,
  line,
  pricingVersion,
  leadTimeDays,
  imported,
}: {
  product: Product;
  line: ProductLine;
  pricingVersion: string;
  leadTimeDays: number;
  imported?: ImportPayload | null;
}) {
  const router = useRouter();

  // Seam for upstream-design import. No-op today (see lib/import.ts): returns {}, so the
  // initial state below falls back to product defaults. When real mapping lands, these
  // prefilled values flow straight into the form with no further wiring.
  const prefill = mapImportedConfig(imported?.cfg ?? {}, product, line);

  // Route the carried-over image through our own origin so the upstream host is hidden.
  const carriedImageSrc = imported ? `/api/img?src=${encodeURIComponent(imported.img)}` : null;

  // Carried-over reference chips — keep only user-meaningful selections, dropping
  // blind-bot's internal fields (pattern ids, cassette overlays, render mode, …).
  const importedChips = imported
    ? Object.entries(imported.cfg).filter(
        ([k, v]) => v && !/pattern|cassette|variant|asset|overlay|rendermode|top_treatment|fabric/i.test(k)
      )
    : [];

  const [colorId, setColorId] = useState(prefill.colorId ?? product.colors[0].id);
  const [opacityId, setOpacityId] = useState<OpacityId>(prefill.opacityId ?? product.validOpacities[0]);
  const [options, setOptions] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(line.optionGroups.map((g) => [g.key, g.options[0].id])),
    ...(prefill.options ?? {}),
  }));
  const [dims, setDims] = useState<Record<string, string>>(() => {
    const base = Object.fromEntries(
      line.dimensionFields.map((f) => [f.key, String(DEFAULT_DIMS[line.id]?.[f.key] ?? f.min)])
    );
    if (prefill.dimensions) {
      for (const [k, v] of Object.entries(prefill.dimensions)) base[k] = String(v);
    }
    return base;
  });
  const [qty, setQty] = useState(1);

  // Real product photos (local). No per-color photos upstream, so changing color/opacity
  // updates the swatches but not the hero image; the gallery lets the user flip through shots.
  const gallery = [product.imageUrl, ...(product.galleryImages ?? [])];
  const [heroImg, setHeroImg] = useState(product.imageUrl);

  const [computation, setComputation] = useState<QuoteComputation | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pricePending, setPricePending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lastAdded, setLastAdded] = useState<{ quoteRef: string; key: string } | null>(null);

  const color = product.colors.find((c) => c.id === colorId) ?? product.colors[0];

  const dimErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    for (const f of line.dimensionFields) {
      const v = parseFloat(dims[f.key]);
      if (Number.isNaN(v)) errs[f.key] = "Required";
      else if (v < f.min || v > f.max) errs[f.key] = `${f.min}–${f.max} ${f.unit}`;
    }
    return errs;
  }, [dims, line.dimensionFields]);

  const config: ItemConfig = useMemo(
    () => ({
      colorId,
      opacityId,
      options,
      dimensions: Object.fromEntries(
        Object.entries(dims).map(([k, v]) => [k, parseFloat(v)])
      ),
    }),
    [colorId, opacityId, options, dims]
  );

  // "Added" confirmation is derived, not stored: it shows only while the config +
  // qty still match what was last added, so changing anything clears it — no effect needed.
  const configKey = useMemo(() => `${JSON.stringify(config)}|${qty}`, [config, qty]);
  const added = lastAdded?.key === configKey ? lastAdded : null;

  // ---- backend auto-quote, debounced ----
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchPrice = useCallback(() => {
    if (Object.keys(dimErrors).length > 0) {
      setComputation(null);
      setPriceError(null);
      return;
    }
    setPricePending(true);
    fetch("/api/price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: product.id, config }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Pricing failed");
        setComputation(data.computation);
        setPriceError(null);
      })
      .catch((e: Error) => {
        setComputation(null);
        setPriceError(e.message);
      })
      .finally(() => setPricePending(false));
  }, [config, dimErrors, product.id]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fetchPrice, 280);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchPrice]);

  // Once the import payload has been read (server-side, into props), drop the handoff
  // params from the visible URL so the upstream image URL doesn't linger in the address
  // bar or browser history.
  useEffect(() => {
    if (!imported) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("img") || url.searchParams.has("cfg") || url.searchParams.has("line")) {
      url.searchParams.delete("img");
      url.searchParams.delete("cfg");
      url.searchParams.delete("line");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToQuote = async () => {
    if (!computation) return;
    setAdding(true);
    try {
      const r = await fetch("/api/quote-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, config, qty }),
      });
      if (r.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not add to quote");
      setLastAdded({ quoteRef: data.quoteRef, key: configKey });
      router.refresh();
    } catch (e) {
      setPriceError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ---------- left: render ---------- */}
      <div className="lg:col-span-3">
        <Card className="overflow-hidden">
          <div className="relative aspect-[4/3] bg-[#f1efe9]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imported ? carriedImageSrc ?? "" : heroImg}
              alt={imported ? "Carried over design" : product.name}
              className="h-full w-full object-cover"
            />
            <div className="absolute left-4 top-4 rounded-lg bg-white/85 px-2.5 py-1 text-[11px] font-medium text-ink-soft shadow-sm backdrop-blur">
              {imported ? "Carried over" : "Real product photo"}
            </div>
          </div>
          {imported ? (
            importedChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-3.5">
                {importedChips.map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded-md bg-[#f1efe9] px-2 py-0.5 text-[11px] text-ink-soft"
                  >
                    <span className="font-medium capitalize">{k.replace(/_/g, " ")}</span>: {v}
                  </span>
                ))}
              </div>
            )
          ) : (
            gallery.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto border-t border-line px-5 py-3.5">
                {gallery.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setHeroImg(src)}
                    className={cx(
                      "h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                      src === heroImg ? "border-ink" : "border-transparent hover:border-line"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )
          )}
        </Card>

        {/* breakdown */}
        <Card className="mt-5 px-5 py-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Quote breakdown</h3>
            <Badge tone="slate">pricing v{pricingVersion}</Badge>
          </div>
          {computation ? (
            <div className="mt-3">
              <table className="w-full text-[13px]">
                <tbody>
                  {computation.lines.map((l, i) => (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="py-2 pr-2 font-medium text-ink-soft">{l.label}</td>
                      <td className="py-2 pr-2 text-xs text-muted">{l.detail}</td>
                      <td className="py-2 text-right font-medium tabular-nums text-ink">{usd(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap gap-2">
                {computation.facts.map((f) => (
                  <span key={f.label} className="rounded-lg bg-[#f1efe9] px-2.5 py-1 text-[11.5px] text-ink-soft">
                    <span className="font-medium">{f.label}:</span> {f.value}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              {priceError ?? "Enter valid dimensions to price this configuration."}
            </p>
          )}
        </Card>
      </div>

      {/* ---------- right: configuration ---------- */}
      <div className="lg:col-span-2">
        <div className="sticky top-8 space-y-5">
          <Card className="px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-ink">{product.name}</h1>
                <div className="mt-0.5 text-xs text-muted">
                  {line.name} · {product.sku} · {TIER_LABELS[product.tier]} tier
                </div>
              </div>
              <Badge tone="brass">~{leadTimeDays}d lead</Badge>
            </div>

            {/* color */}
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                Color — {color.name}
              </div>
              <div className="flex flex-wrap gap-2">
                {product.colors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setColorId(c.id)}
                    title={c.name}
                    className={cx(
                      "size-9 rounded-full border-2 transition-all",
                      c.id === colorId
                        ? "scale-110 border-ink shadow-md"
                        : "border-white shadow-sm hover:scale-105"
                    )}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>

            {/* opacity — the constrained variation */}
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Opacity</div>
              <div className="grid grid-cols-2 gap-1.5">
                {line.opacities.map((op) => {
                  const valid = product.validOpacities.includes(op.id);
                  return (
                    <button
                      key={op.id}
                      disabled={!valid}
                      onClick={() => setOpacityId(op.id)}
                      className={cx(
                        "rounded-xl border px-3 py-2 text-left text-[12.5px] font-medium transition-all",
                        op.id === opacityId && valid
                          ? "border-ink bg-ink text-white shadow-sm"
                          : valid
                            ? "border-line bg-surface text-ink-soft hover:border-[#cfcabd]"
                            : "cursor-not-allowed border-dashed border-line bg-transparent text-muted/50 line-through"
                      )}
                      title={valid ? undefined : `Not producible for ${product.name}`}
                    >
                      {op.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                Greyed options aren&apos;t producible for this pattern — validated against the supply chain.
              </p>
            </div>

            {/* option groups */}
            {line.optionGroups.map((g) => (
              <div key={g.key} className="mt-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{g.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.options.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setOptions((prev) => ({ ...prev, [g.key]: o.id }))}
                      title={o.hint}
                      className={cx(
                        "rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition-all",
                        options[g.key] === o.id
                          ? "border-ink bg-ink text-white shadow-sm"
                          : "border-line bg-surface text-ink-soft hover:border-[#cfcabd]"
                      )}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* dimensions */}
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Dimensions</div>
              <div className="grid grid-cols-2 gap-3">
                {line.dimensionFields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-[12px] font-medium text-ink-soft">{f.label}</span>
                    <div
                      className={cx(
                        "mt-1 flex items-center rounded-xl border bg-surface px-3 py-2 transition-colors focus-within:border-ink",
                        dimErrors[f.key] ? "border-red-300" : "border-line"
                      )}
                    >
                      <input
                        type="number"
                        value={dims[f.key]}
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        onChange={(e) => setDims((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        className="w-full bg-transparent text-sm font-medium text-ink outline-none"
                      />
                      <span className="ml-1 text-xs text-muted">{f.unit}</span>
                    </div>
                    <span className={cx("mt-0.5 block text-[10.5px]", dimErrors[f.key] ? "text-red-500" : "text-muted")}>
                      {dimErrors[f.key] ?? f.help ?? `${f.min}–${f.max} ${f.unit}`}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </Card>

          {/* price + add */}
          <Card className="px-5 py-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted">Unit price · FOB</div>
                <div className={cx("mt-1 text-3xl font-semibold tracking-tight text-ink", pricePending && "opacity-40")}>
                  {computation ? usd(computation.unitPrice) : "—"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted">Qty</span>
                <div className="flex items-center rounded-xl border border-line">
                  <button
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="px-3 py-1.5 text-ink-soft hover:text-ink"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-semibold tabular-nums">{qty}</span>
                  <button
                    onClick={() => setQty((q) => Math.min(500, q + 1))}
                    className="px-3 py-1.5 text-ink-soft hover:text-ink"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            {computation && qty > 1 && (
              <div className="mt-1 text-xs text-muted">
                Line total <span className="font-semibold text-ink">{usd(computation.unitPrice * qty)}</span>
              </div>
            )}
            {priceError && computation === null && (
              <p className="mt-2 text-xs text-red-500">{priceError}</p>
            )}

            <button
              onClick={addToQuote}
              disabled={!computation || adding}
              className={cx(
                "mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-all",
                computation && !adding
                  ? "bg-ink text-white shadow-sm hover:bg-[#2a3756] hover:shadow"
                  : "cursor-not-allowed bg-[#e9e6dd] text-muted"
              )}
            >
              {adding ? "Adding…" : added ? "✓ Added — add another" : "Add to quote"}
            </button>
            {added && (
              <Link href="/quotes" className="mt-2 block text-center text-xs font-medium text-brass hover:underline">
                Added to {added.quoteRef} — review quote →
              </Link>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
