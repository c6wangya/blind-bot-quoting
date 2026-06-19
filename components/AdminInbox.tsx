"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationListItem } from "@/lib/db";
import { ChatThread } from "./ChatThread";
import { cx } from "./ui";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function label(c: ConversationListItem): string {
  return c.retailerCompany || c.retailerEmail;
}

/** Admin support inbox: conversation list (left) + thread (right). Collapses to one pane on mobile. */
export default function AdminInbox({ initialConversations }: { initialConversations: ConversationListItem[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const r = await fetch("/api/messages/conversations", { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.conversations)) setConversations(data.conversations);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refreshList, 10000);
    return () => clearInterval(id);
  }, [refreshList]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex gap-4">
      {/* Conversation list */}
      <div className={cx("w-full md:w-72 md:shrink-0", selectedId && "hidden md:block")}>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {conversations.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No conversations yet.</p>
          ) : (
            <ul className="max-h-[70dvh] divide-y divide-line overflow-y-auto md:max-h-[68vh]">
              {conversations.map((c) => {
                const active = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        setSelectedId(c.id);
                        // optimistic: clear the unread dot immediately
                        setConversations((list) => list.map((x) => (x.id === c.id ? { ...x, unread: false } : x)));
                      }}
                      className={cx(
                        "flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-[#faf9f5]",
                        active && "bg-[#f4f2ec]"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {c.unread && <span className="size-2 shrink-0 rounded-full bg-brass" />}
                        <span className={cx("flex-1 truncate text-sm", c.unread ? "font-semibold text-ink" : "font-medium text-ink-soft")}>
                          {label(c)}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-muted">{fmtWhen(c.lastMessageAt)}</span>
                      </div>
                      <span className="truncate text-[12px] text-muted">
                        {c.lastSenderRole === "admin" && "You: "}
                        {c.lastMessagePreview ?? "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className={cx("min-w-0 flex-1", !selectedId && "hidden md:block")}>
        {selected ? (
          <ChatThread
            key={selected.id}
            role="admin"
            conversationId={selected.id}
            initialMessages={[]}
            peerName={label(selected)}
            onActivity={refreshList}
            header={
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden -ml-1 rounded-lg px-2 py-1 text-sm text-muted hover:text-ink"
                  aria-label="Back"
                >
                  ‹
                </button>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5b6b8f] to-[#3a4763] text-[11px] font-semibold text-white">
                  {(label(selected).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("") || "?").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{label(selected)}</div>
                  <div className="truncate text-[11px] text-muted">{selected.retailerEmail}</div>
                </div>
              </div>
            }
          />
        ) : (
          <div className="flex h-[70dvh] md:h-[68vh] items-center justify-center rounded-2xl border border-line bg-surface text-sm text-muted">
            Select a conversation to view the thread.
          </div>
        )}
      </div>
    </div>
  );
}
