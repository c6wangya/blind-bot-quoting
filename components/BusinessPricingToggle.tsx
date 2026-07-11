"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "./Toast";
import { cx } from "./ui";

/**
 * Admin: authorize a retailer for BUSINESS pricing. Off (default) = the customer sees the shared
 * Default tier; on = the shared Business tier (with any per-motor override below still winning on
 * top). Sales flip this after meeting a customer — until then they get default retail pricing.
 */
export function BusinessPricingToggle({
  retailerId,
  label,
  initialEnabled,
}: {
  retailerId: string;
  label: string;
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next = !on;
    setBusy(true);
    setOn(next); // optimistic
    try {
      const r = await fetch("/api/motors/business-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retailerId, enabled: next }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
      toast(next ? `${label} now gets Business pricing` : `${label} back on Default pricing`);
      router.refresh();
    } catch (e) {
      setOn(!next);
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-4">
      <div className={cx("flex items-center justify-between gap-3", busy && "opacity-70")}>
        <div>
          <div className="text-[13.5px] font-semibold text-ink">Business pricing</div>
          <div className="mt-1 text-[12px] text-muted">
            Authorize this customer for the shared Business tier. Off = they see Default (retail)
            pricing. Per-motor overrides below still win on top.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={toggle}
          className={cx(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed",
            on ? "bg-ink" : "bg-line"
          )}
        >
          <span className={cx("absolute top-0.5 size-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
    </div>
  );
}
