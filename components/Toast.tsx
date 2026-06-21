"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { cx } from "./ui";

type ToastType = "success" | "error";
type ToastItem = { id: number; message: string; type: ToastType };

// Default no-op so calling useToast() outside the provider (e.g. on /login) is harmless.
const ToastCtx = createContext<(message: string, type?: ToastType) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, type: ToastType = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "rise pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg",
              t.type === "error" ? "bg-red-600" : "bg-ink"
            )}
          >
            <span>{t.type === "error" ? "⚠" : "✓"}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
