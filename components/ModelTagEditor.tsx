"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AttributeWithValues } from "@/lib/db";
import { Button, Card, cx } from "./ui";

export type TaggableModel = { id: string; name: string; sku: string; categoryName: string };

/** Admin per-model tag assignment for orderable motor models. */
export function ModelTagEditor({
  models,
  attributes,
  tagMap,
}: {
  models: TaggableModel[];
  attributes: AttributeWithValues[];
  tagMap: Record<string, string[]>;
}) {
  if (attributes.length === 0) {
    return (
      <Card className="px-5 py-6 text-center text-sm text-muted">
        Define attributes above first, then assign their values to each motor here.
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line/70">
        {models.map((model) => (
          <ModelRow key={model.id} model={model} attributes={attributes} initial={tagMap[model.id] ?? []} />
        ))}
      </ul>
    </Card>
  );
}

function ModelRow({
  model,
  attributes,
  initial,
}: {
  model: TaggableModel;
  attributes: AttributeWithValues[];
  initial: string[];
}) {
  const router = useRouter();
  const initialSet = useMemo(() => new Set(initial), [initial]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(() => {
    if (selected.size !== initialSet.size) return true;
    for (const id of selected) if (!initialSet.has(id)) return true;
    return false;
  }, [selected, initialSet]);

  const toggle = (attr: AttributeWithValues, valueId: string) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(valueId)) {
        next.delete(valueId);
      } else {
        if (!attr.multi) for (const v of attr.values) next.delete(v.id); // single → clear siblings
        next.add(valueId);
      }
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/tags/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: model.id, valueIds: [...selected] }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] font-semibold text-ink">{model.name}</span>
        <span className="rounded bg-[#f1efe9] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft">{model.sku}</span>
        <span className="text-[11px] text-muted">{model.categoryName}</span>
        <div className="ml-auto flex items-center gap-2">
          {saved && !dirty && <span className="text-[11px] font-medium text-emerald-600">Saved ✓</span>}
          <Button variant="primary" onClick={save} busy={busy} disabled={!dirty} className="py-1.5 text-[12px]">
            Save
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {attributes.map((attr) => (
          <div key={attr.id} className="flex flex-wrap items-center gap-1.5">
            <span className="w-40 shrink-0 text-[11.5px] font-medium uppercase tracking-wide text-muted">
              {attr.name}
            </span>
            {attr.values.length === 0 && <span className="text-[11.5px] text-muted/70">— no values</span>}
            {attr.values.map((v) => {
              const on = selected.has(v.id);
              return (
                <button
                  key={v.id}
                  onClick={() => toggle(attr, v.id)}
                  className={cx(
                    "rounded-lg px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors",
                    on
                      ? "bg-ink text-white ring-ink"
                      : "bg-surface text-ink-soft ring-line hover:bg-[#faf9f5]"
                  )}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </li>
  );
}
