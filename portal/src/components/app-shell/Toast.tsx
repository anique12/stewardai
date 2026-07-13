"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { subscribeToast, type ToastPayload } from "@/lib/toast";

const AUTO_DISMISS_MS = 4000;

/** Fixed bottom-center toast host. Mount once in `AppChrome`; push via `showToast(...)`. */
export function Toast() {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeToast((payload) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast(payload);
      timerRef.current = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    });
  }, []);

  if (!toast || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="steward-app fixed bottom-[26px] left-1/2 z-[300] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3.5 rounded-xl bg-ink py-[11px] pl-4 pr-[14px] text-paper shadow-sh-pop"
      role="status"
      aria-live="polite"
    >
      <span className="h-2 w-2 shrink-0 rounded-pill bg-brand shadow-[0_0_8px_var(--brand)]" aria-hidden />
      <span className="text-[13px] font-medium">{toast.message}</span>
      {toast.actionLabel && toast.onAction ? (
        <button
          type="button"
          onClick={() => {
            toast.onAction?.();
            setToast(null);
          }}
          className="rounded-lg bg-white/[.08] px-[11px] py-[5px] text-[12.5px] font-semibold text-brand"
        >
          {toast.actionLabel}
        </button>
      ) : null}
    </div>,
    document.body
  );
}
