"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActingAs } from "@/lib/auth/acting-as-actions";

export type RetailerOption = { id: string; email: string; company: string | null };

/**
 * Admin-only "act-on-behalf-of" switcher, rendered inside the sidebar nav. Picking a retailer
 * enters their context — quotes/pre-orders built afterwards are owned by that retailer. The
 * control turns amber while acting so the context stays unmistakable without cluttering the page.
 */
export function ActingAsSwitcher({
  retailers,
  actingAsId,
}: {
  retailers: RetailerOption[];
  actingAsId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const label = (r: RetailerOption) => r.company || r.email;
  const acting = !!actingAsId && retailers.some((r) => r.id === actingAsId);

  const apply = (id: string | null) =>
    startTransition(async () => {
      await setActingAs(id);
      router.refresh();
    });

  return (
    <div className="px-3 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        <span className={`size-1.5 rounded-full ${acting ? "bg-amber-400" : "bg-white/20"}`} />
        Acting as
      </div>
      <select
        value={actingAsId ?? ""}
        disabled={pending || retailers.length === 0}
        onChange={(e) => apply(e.target.value || null)}
        className={`w-full rounded-lg border px-2 py-1.5 text-[12.5px] transition-colors ${
          acting
            ? "border-amber-400/60 bg-amber-400/15 text-amber-100"
            : "border-white/10 bg-white/[0.04] text-white/80"
        }`}
      >
        <option value="">{retailers.length ? "Order for myself" : "No retailers"}</option>
        {retailers.map((r) => (
          <option key={r.id} value={r.id} className="text-ink">
            {label(r)}
          </option>
        ))}
      </select>
      {acting && (
        <button
          type="button"
          disabled={pending}
          onClick={() => apply(null)}
          className="mt-1.5 px-1 text-[11px] font-medium text-amber-300/90 transition-colors hover:text-amber-200 disabled:opacity-60"
        >
          Exit acting mode
        </button>
      )}
    </div>
  );
}
