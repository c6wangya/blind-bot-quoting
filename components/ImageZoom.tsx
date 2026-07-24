"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui";

/**
 * Full-screen image lightbox, shared across the app so every product/item
 * photo can be clicked to enlarge. Mirrors the inline zoom that already
 * existed in AccessoryBrowser (click backdrop / ESC to close).
 */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-8"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded-xl bg-[#0e0e10] object-contain p-2"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}

type Props = {
  src: string;
  alt?: string;
  className?: string;
  /** Image to show enlarged (defaults to `src`, e.g. a higher-res variant). */
  zoomSrc?: string;
  /**
   * "image"  — the whole image is the click target (use when nothing behind
   *            it is clickable).
   * "badge"  — a small magnifier button overlays the top-right corner and is
   *            the only zoom trigger, so a clickable parent (a Link/row) keeps
   *            working. Default.
   */
  trigger?: "image" | "badge";
};

export function ZoomableImg({ src, alt = "", className, zoomSrc, trigger = "badge" }: Props) {
  const [open, setOpen] = useState(false);
  const full = zoomSrc ?? src;

  const openZoom = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      {trigger === "image" ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt}
          onClick={openZoom}
          className={cx(className, "cursor-zoom-in")}
        />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className={className} />
          <button
            type="button"
            onClick={openZoom}
            aria-label="Enlarge image"
            className={cx(
              "absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-full",
              "bg-black/45 text-white opacity-0 backdrop-blur transition-opacity",
              "hover:bg-black/65 focus-visible:opacity-100 group-hover:opacity-100"
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
            </svg>
          </button>
        </>
      )}
      {open && <Lightbox src={full} onClose={() => setOpen(false)} />}
    </>
  );
}
