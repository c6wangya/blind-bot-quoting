"use client";

import { useState } from "react";
import { useToast } from "./Toast";
import { Button, Card, Spinner } from "./ui";

type Result = {
  total: number;
  created: string[];
  skipped: string[];
  failed: { email: string; reason: string }[];
};

export function SyncClientsButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const sync = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/sync-clients", { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Sync failed");
      setResult(data as Result);
      toast(`Synced ${data.created.length} new account(s)`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl space-y-4 p-5">
      <Button variant="primary" busy={busy} onClick={sync} className="gap-2 py-2">
        {busy && <Spinner />}
        {busy ? "Syncing…" : "Sync now"}
      </Button>

      {busy && (
        <p className="text-sm text-muted">
          Pulling clients from blind-bot and provisioning accounts — this can take a moment.
        </p>
      )}

      {!busy && result && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            Scanned <span className="font-semibold text-ink">{result.total}</span> blind-bot client(s):{" "}
            <span className="font-semibold text-ink">{result.created.length}</span> created,{" "}
            {result.skipped.length} already present
            {result.failed.length > 0 && (
              <>
                , <span className="font-semibold text-red-600">{result.failed.length}</span> failed
              </>
            )}
            .
          </p>

          {result.created.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Synced accounts ({result.created.length})
              </p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {result.created.map((email) => (
                  <li key={email} className="break-words px-3 py-1.5 text-ink">
                    {email}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.created.length === 0 && result.failed.length === 0 && (
            <p className="text-muted">Everyone is already in quoting — nothing new to sync.</p>
          )}

          {result.failed.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-red-600">
                Failed ({result.failed.length})
              </p>
              <ul className="list-inside list-disc text-red-600">
                {result.failed.map((f) => (
                  <li key={f.email} className="break-words">
                    {f.email} — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
