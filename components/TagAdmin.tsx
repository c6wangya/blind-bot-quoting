"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AttributeWithValues } from "@/lib/db";
import { Button, Card, cx } from "./ui";

async function call(url: string, method: string, body: unknown): Promise<string | null> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) return null;
  const data = await r.json().catch(() => ({}));
  return data.error ?? "Request failed";
}

/** Admin manager for attributes (dimensions) and their values. */
export function TagAdmin({ attributes }: { attributes: AttributeWithValues[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    if (err) setError(err);
    else router.refresh();
    setBusy(false);
  };

  const addAttribute = () =>
    run(async () => {
      const err = await call("/api/tags/attributes", "POST", { name, multi });
      if (!err) {
        setName("");
        setMulti(false);
      }
      return err;
    });

  return (
    <div className="space-y-4">
      {attributes.length === 0 && (
        <Card className="px-5 py-6 text-center text-sm text-muted">
          No attributes yet. Create one below (e.g. <span className="font-medium text-ink-soft">Power</span> or{" "}
          <span className="font-medium text-ink-soft">Compatible products</span>).
        </Card>
      )}

      {attributes.map((a) => (
        <AttributeCard key={a.id} attribute={a} busy={busy} run={run} />
      ))}

      <Card className="px-5 py-4">
        <div className="text-[13px] font-semibold text-ink">New attribute</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Attribute name (e.g. Power)"
            className="min-w-[220px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
          />
          <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink-soft">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            Multiple values per model
          </label>
          <Button variant="primary" onClick={addAttribute} busy={busy} className="py-2">
            Add attribute
          </Button>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          Single-value (e.g. Power: AC/DC/Battery — a motor is one) vs. multiple (e.g. Compatible products — a
          motor can fit several).
        </p>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </Card>
    </div>
  );
}

function AttributeCard({
  attribute,
  busy,
  run,
}: {
  attribute: AttributeWithValues;
  busy: boolean;
  run: (fn: () => Promise<string | null>) => Promise<void>;
}) {
  const [label, setLabel] = useState("");

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold text-ink">{attribute.name}</span>
        <span
          className={cx(
            "rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-inset",
            attribute.multi ? "bg-blue-50 text-blue-700 ring-blue-200" : "bg-slate-100 text-slate-600 ring-slate-200"
          )}
        >
          {attribute.multi ? "multiple" : "single"}
        </span>
        <button
          onClick={() => run(() => call("/api/tags/attributes", "DELETE", { id: attribute.id }))}
          disabled={busy}
          className="ml-auto text-[11.5px] font-medium text-muted transition-colors hover:text-red-500"
        >
          Delete attribute
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {attribute.values.length === 0 && <span className="text-[12px] text-muted">No values yet.</span>}
        {attribute.values.map((v) => (
          <span
            key={v.id}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f1efe9] px-2.5 py-1 text-[12px] font-medium text-ink-soft"
          >
            {v.label}
            <button
              onClick={() => run(() => call("/api/tags/values", "DELETE", { id: v.id }))}
              disabled={busy}
              aria-label={`Remove ${v.label}`}
              className="text-muted transition-colors hover:text-red-500"
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add value…"
          className="w-44 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) {
              run(async () => {
                const err = await call("/api/tags/values", "POST", { attributeId: attribute.id, label });
                if (!err) setLabel("");
                return err;
              });
            }
          }}
        />
        <Button
          variant="secondary"
          busy={busy}
          className="py-1.5 text-[13px]"
          onClick={() =>
            run(async () => {
              const err = await call("/api/tags/values", "POST", { attributeId: attribute.id, label });
              if (!err) setLabel("");
              return err;
            })
          }
        >
          Add value
        </Button>
      </div>
    </Card>
  );
}
