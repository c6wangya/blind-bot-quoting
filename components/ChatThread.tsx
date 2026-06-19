"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatRole } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { Button, cx } from "./ui";

type UiMessage = ChatMessage & { pending?: boolean };

const GROUP_GAP = 5 * 60 * 1000; // 5 min — bubbles closer than this from one sender are grouped
const EMOJIS = [
  "👍", "🙏", "😊", "😂", "🎉", "✅", "❤️", "🔥", "👀", "🙌",
  "💡", "⚠️", "📦", "🚚", "📅", "💰", "✨", "👌", "🤔", "👋",
  "🙂", "😅", "💬", "⭐", "❓", "❗", "🆗", "🟢", "🔴", "📷",
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function Avatar({ support, name, large = false }: { support: boolean; name: string; large?: boolean }) {
  // Literal size classes only — Tailwind can't see interpolated ones.
  const box = cx(
    "shrink-0 rounded-full flex items-center justify-center text-white font-semibold",
    large ? "size-12" : "size-7"
  );
  if (support) {
    return <div className={cx(box, "bg-gradient-to-br from-brass to-[#8a6a39]", large ? "text-lg" : "text-[11px]")}>{BRAND.monogram}</div>;
  }
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  return <div className={cx(box, "bg-gradient-to-br from-[#5b6b8f] to-[#3a4763]", large ? "text-sm" : "text-[10px]")}>{initials}</div>;
}

/**
 * Shared chat thread (retailer + admin). Polls every 5s, sends optimistically
 * ("Sending…" → "Sent" → "Read"), groups consecutive bubbles, adds date separators +
 * peer avatars, and offers an emoji picker. Marks the conversation read when the latest
 * message is from the other party. For the retailer the conversation is created on first send.
 */
export function ChatThread({
  role,
  conversationId: initialConvId,
  initialMessages,
  initialPeerReadAt = null,
  peerName,
  peerSupport = false,
  header,
  onActivity,
}: {
  role: ChatRole;
  conversationId: string | null;
  initialMessages: ChatMessage[];
  initialPeerReadAt?: string | null;
  peerName: string;
  peerSupport?: boolean;
  header?: React.ReactNode;
  onActivity?: () => void;
}) {
  const [convId, setConvId] = useState(initialConvId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [pending, setPending] = useState<UiMessage[]>([]);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(initialPeerReadAt);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastReadId = useRef<string | null>(null);
  const bottomPinned = useRef(true);
  const tmpSeq = useRef(0);

  const getUrl = role === "admin" && convId ? `/api/messages?conversationId=${convId}` : "/api/messages";

  const all: UiMessage[] = [...messages, ...pending];
  const lastMineId = [...all].reverse().find((m) => m.senderRole === role)?.id ?? null;

  const markRead = useCallback(async () => {
    const latest = messages[messages.length - 1];
    if (!latest || latest.senderRole === role || latest.id === lastReadId.current) return;
    lastReadId.current = latest.id;
    await fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(convId ? { conversationId: convId } : {}),
    }).catch(() => {});
    onActivity?.();
  }, [messages, role, convId, onActivity]);

  useEffect(() => {
    if (role === "admin" && !convId) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(getUrl, { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (!alive) return;
        if (Array.isArray(data.messages)) setMessages(data.messages);
        if ("peerLastReadAt" in data) setPeerReadAt(data.peerLastReadAt ?? null);
        if (data.conversationId && !convId) setConvId(data.conversationId);
      } catch {
        /* transient */
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [getUrl, role, convId]);

  useEffect(() => {
    markRead();
  }, [markRead]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && bottomPinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    bottomPinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const insertEmoji = (emoji: string) => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setShowEmoji(false);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    const tmpId = `tmp-${tmpSeq.current++}`;
    setBusy(true);
    setErr(null);
    setText("");
    setShowEmoji(false);
    bottomPinned.current = true;
    setPending((p) => [
      ...p,
      { id: tmpId, conversationId: convId ?? "", senderId: "", senderRole: role, body, createdAt: new Date().toISOString(), pending: true },
    ]);
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(role === "admin" ? { conversationId: convId, body } : { body }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Failed to send");
      if (data.conversationId && !convId) setConvId(data.conversationId);
      if (data.message) setMessages((m) => [...m, data.message as ChatMessage]);
      setPending((p) => p.filter((x) => x.id !== tmpId));
      onActivity?.();
    } catch (e) {
      setPending((p) => p.filter((x) => x.id !== tmpId));
      setText(body);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (role === "admin" && !convId) {
    return (
      <div className="flex h-[70dvh] items-center justify-center rounded-2xl border border-line bg-surface text-sm text-muted md:h-[68vh]">
        Select a conversation to view the thread.
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-12rem)] min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface md:h-[68vh]">
      {header && <div className="shrink-0 border-b border-line px-4 py-3">{header}</div>}

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {all.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Avatar support={peerSupport} name={peerName} large />
            <p className="mt-1 text-sm font-medium text-ink">
              {role === "retailer" ? "Start a conversation" : "No messages yet"}
            </p>
            <p className="max-w-xs text-[13px] leading-relaxed text-muted">
              {role === "retailer"
                ? "Ask us anything about products, pricing, lead times, or your orders — we'll reply right here."
                : "Replies you send will appear here."}
            </p>
          </div>
        ) : (
          all.map((m, i) => {
            const prev = all[i - 1];
            const next = all[i + 1];
            const mine = m.senderRole === role;
            const showDate = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const groupedWithPrev =
              !!prev && prev.senderRole === m.senderRole && !showDate &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_GAP;
            const groupedWithNext =
              !!next && next.senderRole === m.senderRole &&
              new Date(next.createdAt).toDateString() === new Date(m.createdAt).toDateString() &&
              new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < GROUP_GAP;
            const groupEnd = !groupedWithNext;
            const status = m.pending
              ? "Sending…"
              : mine && m.id === lastMineId
                ? peerReadAt && new Date(peerReadAt) >= new Date(m.createdAt)
                  ? "Read"
                  : "Sent"
                : null;

            return (
              <div key={m.id}>
                {showDate && (
                  <div className="my-4 flex items-center justify-center">
                    <span className="rounded-full bg-[#efece4] px-3 py-0.5 text-[11px] font-medium text-muted">
                      {dayLabel(m.createdAt)}
                    </span>
                  </div>
                )}
                <div
                  className={cx(
                    "flex items-end gap-2",
                    mine ? "justify-end" : "justify-start",
                    groupedWithPrev ? "mt-0.5" : "mt-3"
                  )}
                >
                  {!mine && <div className="w-7 shrink-0">{groupEnd && <Avatar support={peerSupport} name={peerName} />}</div>}
                  <div className={cx("max-w-[78%] sm:max-w-[70%]", mine && "items-end")}>
                    <div
                      className={cx(
                        "whitespace-pre-wrap break-words px-3.5 py-2 text-sm leading-relaxed",
                        mine
                          ? cx("rounded-2xl bg-ink text-white", groupEnd && "rounded-br-md", m.pending && "opacity-70")
                          : cx("rounded-2xl border border-line bg-[#faf9f5] text-ink", groupEnd && "rounded-bl-md")
                      )}
                    >
                      {m.body}
                    </div>
                    {groupEnd && (
                      <div className={cx("mt-1 px-1 text-[10.5px] text-muted", mine ? "text-right" : "text-left")}>
                        {fmtTime(m.createdAt)}
                        {status && <span className={cx(status === "Read" && "text-brass")}> · {status}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="relative shrink-0 border-t border-line bg-surface px-3 py-3">
        {err && <p className="mb-2 text-[12px] text-red-500">{err}</p>}

        {showEmoji && (
          <>
            <div className="fixed inset-0 z-0" onClick={() => setShowEmoji(false)} aria-hidden />
            <div className="absolute bottom-full left-3 z-10 mb-2 grid w-[15rem] grid-cols-8 gap-1 rounded-2xl border border-line bg-surface p-2 shadow-lg">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => insertEmoji(e)}
                  className="rounded-lg py-1 text-lg hover:bg-[#f4f2ec]"
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowEmoji((s) => !s)}
            aria-label="Emoji"
            className="flex h-[44px] w-10 shrink-0 items-center justify-center rounded-xl border border-line text-lg text-muted hover:bg-[#faf9f5] hover:text-ink"
          >
            😊
          </button>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Type a message…"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink"
          />
          <Button variant="primary" busy={busy} disabled={!text.trim()} className="h-[44px] px-5" onClick={send}>
            Send
          </Button>
        </div>
        <p className="mt-1.5 hidden px-1 text-[11px] text-muted sm:block">
          Press <span className="font-medium">Enter</span> to send · <span className="font-medium">Shift+Enter</span> for a new line
        </p>
      </div>
    </div>
  );
}
