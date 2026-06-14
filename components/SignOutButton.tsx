"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cx } from "./ui";

export default function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const supabase = createClient();
  return (
    <button
      onClick={async () => {
        if (!supabase) return;
        await supabase.auth.signOut();
        router.refresh();
      }}
      className={cx(
        "rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-[#faf9f5]",
        className
      )}
    >
      Sign out
    </button>
  );
}
