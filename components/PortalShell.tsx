"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { BRAND } from "@/lib/brand";

/**
 * Portal chrome: fixed sidebar on desktop, slide-in drawer on mobile (with a top bar +
 * hamburger). Owns the drawer open state and the live unread-message count (seeded from the
 * server, refreshed on navigation + a light poll) shared by the sidebar badge and the
 * mobile top-bar dot.
 */
export default function PortalShell({
  draftCount,
  unreadCount,
  accountName,
  accountSub,
  signedIn,
  isAdmin,
  children,
}: {
  draftCount: number;
  unreadCount: number;
  accountName: string;
  accountSub: string;
  signedIn: boolean;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(unreadCount);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/messages/unread", { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (alive && typeof data.count === "number") setUnread(data.count);
      } catch {
        /* transient */
      }
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [signedIn, pathname]);

  const close = () => setOpen(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="relative -ml-1 rounded-lg p-2 text-ink hover:bg-[#f4f2ec]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
          {unread > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-red-500" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brass to-[#8a6a39] text-xs font-bold text-white">
            {BRAND.monogram}
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-ink">{BRAND.name}</span>
        </div>
      </div>

      {/* Backdrop (mobile only, when drawer open) */}
      {open && <div onClick={close} className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden />}

      <Sidebar
        draftCount={draftCount}
        unread={unread}
        accountName={accountName}
        accountSub={accountSub}
        signedIn={signedIn}
        isAdmin={isAdmin}
        open={open}
        onClose={close}
      />

      <main className="min-h-screen pt-14 md:ml-60 md:pt-0">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-8 md:py-10">{children}</div>
      </main>
    </>
  );
}
