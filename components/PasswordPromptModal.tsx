"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui";

// Per-session guard so the dialog pops at most once per sign-in (survives client navigation).
const SHOWN_KEY = "pw-prompt-shown";
const EVENT = "pw-prompt-change";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
function markShown() {
  sessionStorage.setItem(SHOWN_KEY, "1");
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Shown only when the server says the user is still on the migration's initial password
 * (`user_metadata.must_change_password`). Asks once per session whether to change it:
 *  - Yes  → go to the Account page (the flag clears when they actually set a new password).
 *  - No   → clear the flag so they're never prompted again, on this or future sign-ins.
 */
export function PasswordPromptModal() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const shown = useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(SHOWN_KEY) === "1",
    () => true, // server snapshot: don't render the dialog during SSR
  );

  if (shown) return null;

  const onYes = () => {
    markShown();
    router.push("/account");
  };

  const onNo = async () => {
    setBusy(true);
    try {
      // Never prompt again — clear the flag server-side (not just for this session).
      await supabase?.auth.updateUser({ data: { must_change_password: false } });
    } catch {
      /* best-effort; the session guard still hides it for now */
    } finally {
      markShown();
      setBusy(false);
      router.refresh();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
      <div className="absolute inset-0 bg-black/30" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl"
      >
        <h2 className="text-base font-semibold tracking-tight text-ink">Update your password?</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          You&apos;re signed in with the initial password from your account migration. For your
          security, would you like to set a new one now?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" busy={busy} onClick={onNo} className="py-2">
            Not now
          </Button>
          <Button variant="primary" disabled={busy} onClick={onYes} className="py-2">
            Yes, change it
          </Button>
        </div>
      </div>
    </div>
  );
}
