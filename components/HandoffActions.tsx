"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx } from "./ui";

/**
 * First-time handoff consent: records consent on the user (user_metadata) so future
 * handoffs from blind-bot pass through silently, then continues to the destination.
 */
export function ConsentContinueButton({ next, brand }: { next: string; brand: string }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const sb = createClient();
      if (sb) await sb.auth.updateUser({ data: { bb_handoff_consented: true } });
    } catch {
      // even if recording fails, don't block the user
    }
    window.location.assign(next);
  };
  return (
    <button
      onClick={go}
      disabled={busy}
      className={cx(
        "w-full rounded-xl bg-ink py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#2a3756]",
        busy && "opacity-50"
      )}
    >
      {busy ? "Continuing…" : `Continue to ${brand}`}
    </button>
  );
}
