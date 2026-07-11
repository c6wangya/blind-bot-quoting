"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "./Toast";
import { cx } from "./ui";

/**
 * Admin: exempt a special retailer from shipping. Two independent waivers:
 *   • ground   — never charged standard ground shipping
 *   • expedite — never charged the expedite premium (only available once ground is waived)
 * Turning ground off also clears expedite. A waived quote auto-drops the matching shipping charge.
 */
export function WaiveShippingEditor({
  retailerId,
  label,
  initialGround,
  initialExpedite,
}: {
  retailerId: string;
  label: string;
  initialGround: boolean;
  initialExpedite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [ground, setGround] = useState(initialGround);
  const [expedite, setExpedite] = useState(initialExpedite);
  const [busy, setBusy] = useState<"ground" | "expedite" | null>(null);

  const send = async (kind: "ground" | "expedite", waive: boolean) => {
    const r = await fetch("/api/motors/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retailerId, kind, waive }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
  };

  const toggleGround = async () => {
    const next = !ground;
    setBusy("ground");
    setGround(next); // optimistic
    if (!next) setExpedite(false); // ground off ⇒ expedite off (server clears it too)
    try {
      await send("ground", next);
      toast(next ? `${label} won't be charged ground shipping` : `${label} now pays ground shipping`);
      router.refresh();
    } catch (e) {
      setGround(!next);
      setExpedite(initialExpedite);
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const toggleExpedite = async () => {
    if (!ground) return; // guarded by disabled, but be safe
    const next = !expedite;
    setBusy("expedite");
    setExpedite(next); // optimistic
    try {
      await send("expedite", next);
      toast(next ? `${label} won't be charged expedite shipping` : `${label} now pays expedite shipping`);
      router.refresh();
    } catch (e) {
      setExpedite(!next);
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-5 py-4">
      <div className="text-[13.5px] font-semibold text-ink">Waive shipping</div>
      <div className="mt-1 text-[12px] text-muted">
        Exempt this retailer from shipping charges. Expedite can only be waived once ground is waived.
      </div>
      <div className="mt-3 space-y-2.5">
        <Row
          title="Waive ground shipping"
          sub="Never charged standard ground freight."
          on={ground}
          busy={busy === "ground"}
          disabled={busy !== null}
          onToggle={toggleGround}
        />
        <Row
          title="Waive expedite shipping"
          sub={ground ? "Never charged the expedite premium." : "Waive ground shipping first to enable this."}
          on={expedite}
          busy={busy === "expedite"}
          disabled={busy !== null || !ground}
          onToggle={toggleExpedite}
        />
      </div>
    </div>
  );
}

function Row({
  title,
  sub,
  on,
  busy,
  disabled,
  onToggle,
}: {
  title: string;
  sub: string;
  on: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cx("flex items-center justify-between gap-3", disabled && !busy && "opacity-50")}>
      <div>
        <div className="text-[13px] font-medium text-ink">{title}</div>
        <div className="text-[11.5px] text-muted">{sub}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={onToggle}
        className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed", on ? "bg-ink" : "bg-line")}
      >
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
      </button>
    </div>
  );
}
