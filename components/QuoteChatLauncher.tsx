"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, MessageItemRef, QuoteTag } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { ChatThread } from "./ChatThread";
import { cx } from "./ui";

/** Speech-bubble icon for the floating launcher (inline so it needs no asset). */
function BubbleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H9l-4 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Floating "message us about this quote" bubble for the quote detail page (retailer view).
 * Reuses the shared support ChatThread — messages sent from here are tagged with the quote
 * (a "Re: Q-…" chip both sides see). One conversation per retailer; this is just a quote-aware
 * entry point into it. The unread dot polls the same badge endpoint the sidebar uses.
 */
export function QuoteChatLauncher({
  quote,
  aboutLabel,
  referenceItems,
  conversationId,
  initialMessages,
  initialPeerReadAt,
  initialUnread,
}: {
  quote: QuoteTag;
  // Header subtitle + aria reference; defaults to the quote ref. The order page passes the order
  // ref (PO-…) so the bubble reads "About PO-…" while messages still tag the source quote.
  aboutLabel?: string;
  // Line items the customer can attach to a message (enables the "Reference items" picker).
  referenceItems?: MessageItemRef[];
  conversationId: string | null;
  initialMessages: ChatMessage[];
  initialPeerReadAt: string | null;
  initialUnread: number;
}) {
  const about = aboutLabel ?? quote.ref;
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);

  const refreshUnread = useCallback(async () => {
    try {
      const r = await fetch("/api/messages/unread", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d.count === "number") setUnread(d.count);
    } catch {
      /* transient */
    }
  }, []);

  // While closed, poll the unread badge so the dot appears when support replies. The open
  // thread manages its own polling + marks read (which clears the dot via onActivity).
  useEffect(() => {
    if (open) return;
    const id = setInterval(refreshUnread, 15000);
    return () => clearInterval(id);
  }, [open, refreshUnread]);

  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      if (next) setUnread(0); // opening marks everything read
      return next;
    });

  return (
    <>
      {open && (
        <div className="fixed inset-x-3 bottom-[5.75rem] z-50 sm:inset-x-auto sm:right-6 sm:w-[380px]">
          <div className="flex h-[min(70vh,560px)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
            <ChatThread
              role="retailer"
              conversationId={conversationId}
              initialMessages={initialMessages}
              initialPeerReadAt={initialPeerReadAt}
              peerName={`${BRAND.name} Support`}
              peerSupport
              fill
              quoteContext={quote}
              referenceItems={referenceItems ?? null}
              onActivity={refreshUnread}
              header={
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brass to-[#8a6a39] text-[12px] font-bold text-white">
                    {BRAND.monogram}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{BRAND.name} Support</div>
                    <div className="truncate text-[11px] text-muted">About {about}</div>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Close chat"
                    className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-[#f4f2ec] hover:text-ink"
                  >
                    <CloseIcon className="size-4" />
                  </button>
                </div>
              }
            />
          </div>
        </div>
      )}

      <button
        onClick={toggle}
        aria-label={open ? "Close chat" : `Message us about ${about}`}
        className={cx(
          "fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full text-white shadow-xl",
          "transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2",
          open ? "bg-ink-soft" : "bg-ink"
        )}
      >
        {open ? <CloseIcon className="size-6" /> : <BubbleIcon className="size-7" />}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-brass px-1 text-[11px] font-bold text-white ring-2 ring-surface">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
