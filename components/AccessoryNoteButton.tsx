"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AccessoryModelNote, AccessoryNoteImage } from "@/lib/db";
import { Button, cx } from "./ui";

/** Compatibility note ("works with …") for one accessory model. A small button that sits to the
 *  LEFT of the product's Add button:
 *   - retailers: shown only when a note exists → opens a read-only popup (text + images);
 *   - admins: always shown → opens an editor (edit text, upload/remove images).
 *  Purely retailer-facing display; it never affects pricing or orderability. */
export function AccessoryNoteButton({
  modelId,
  modelName,
  note,
  isAdmin,
}: {
  modelId: string;
  modelName: string;
  note?: AccessoryModelNote;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local mirror of the note so edits show immediately; seeded from server data.
  const [body, setBody] = useState(note?.body ?? "");
  const [images, setImages] = useState<AccessoryNoteImage[]>(note?.images ?? []);

  const hasContent = (note?.body ?? "").trim().length > 0 || (note?.images.length ?? 0) > 0;
  // Retailers only see the button when there's something to show; admins always (to add/edit).
  if (!isAdmin && !hasContent) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const saveBody = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/accessory-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, body }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not save");
      router.refresh();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("modelId", modelId);
      const r = await fetch("/api/accessory-notes/image", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Upload failed");
      setImages((cur) => [...cur, data as AccessoryNoteImage]);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/accessory-notes/image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not remove");
      setImages((cur) => cur.filter((i) => i.id !== id));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => { stop(e); setOpen(true); }}
        title={isAdmin ? "Edit compatibility & fitment note" : "Compatibility & fitment"}
        aria-label={isAdmin ? "Edit compatibility & fitment note" : "Compatibility & fitment"}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-md border p-1.5 transition-colors",
          hasContent
            ? "border-brass/50 bg-brass-soft text-[#8a6a39] hover:border-brass"
            : "border-transparent text-muted hover:text-ink"
        )}
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.2v3.4M8 5.2h.01" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 text-left" onClick={stop}>
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} aria-hidden />
          <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold tracking-tight text-ink">Compatibility & fitment</h2>
                <p className="mt-0.5 truncate text-[11.5px] text-muted">{modelName}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink" aria-label="Close">✕</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {isAdmin ? (
                <>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Notes</label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    placeholder="Which products this part works with, sizing, fitment tips…"
                    className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-ink"
                  />
                </>
              ) : body.trim() ? (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{body}</p>
              ) : null}

              {(images.length > 0 || isAdmin) && (
                <div className="mt-4">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted">Images</span>
                  <div className="flex flex-wrap gap-2">
                    {images.map((im) => (
                      <div key={im.id} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={im.url}
                          alt=""
                          onClick={() => setZoom(im.url)}
                          className="size-20 cursor-zoom-in rounded-lg bg-[#0e0e10] object-contain p-1"
                        />
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => removeImage(im.id)}
                            disabled={busy}
                            className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ink text-[11px] text-white shadow hover:bg-red-600 disabled:opacity-40"
                            aria-label="Remove image"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    {isAdmin && (
                      <label className={cx(
                        "grid size-20 cursor-pointer place-items-center rounded-lg border border-dashed border-line text-[11px] text-muted hover:border-ink hover:text-ink",
                        busy && "pointer-events-none opacity-50"
                      )}>
                        <span className="text-center leading-tight">＋<br />Image</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadImage(f); }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}

              {error && <p className="mt-3 text-[12px] text-red-500">{error}</p>}
            </div>

            {isAdmin && (
              <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
                <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="py-1.5 text-xs">Close</Button>
                <Button variant="primary" onClick={saveBody} busy={busy} className="py-1.5 text-xs">Save notes</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-8" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-xl bg-[#0e0e10] object-contain p-2" />
        </div>
      )}
    </>
  );
}
