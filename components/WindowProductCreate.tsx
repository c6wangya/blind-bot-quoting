"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Input, Select } from "./ui";

/** Create a window product from a template (policies start as "everything offered"). */
export default function WindowProductCreate({
  templates,
}: {
  templates: { id: number; label: string; lineKey: string }[];
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? 0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || !templateId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/window/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create");
      router.push(`/window-products/${body.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-ink">New product</div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Template</span>
          <Select value={templateId} onChange={(e) => setTemplateId(Number(e.target.value))} className="min-w-52">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block flex-1 min-w-56">
          <span className="mb-1 block text-xs font-medium text-muted">Product name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={'e.g. "Premium Roller Shade"'}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </label>
        <Button onClick={create} disabled={busy || !name.trim() || !templateId}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </Card>
  );
}
