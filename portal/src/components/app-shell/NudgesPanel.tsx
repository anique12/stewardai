"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, X } from "lucide-react";
import type { Nudge } from "@/lib/nudges";

function nudgeKey(n: Nudge) {
  return `${n.kind}:${n.href}:${n.title}`;
}

export function NudgesPanel({
  open,
  onOpenChange,
  onCountChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange?: (count: number) => void;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data, isSuccess, isError } = useQuery({
    queryKey: ["nudges"],
    queryFn: async () => {
      const res = await fetch("/api/nudges");
      const data = await res.json().catch(() => ({ nudges: [] }));
      return (Array.isArray(data?.nudges) ? data.nudges : []) as Nudge[];
    },
  });
  const nudges = data ?? [];
  const loaded = isSuccess || isError;

  const visible = nudges.filter((n) => !dismissed.has(nudgeKey(n)));

  useEffect(() => {
    if (loaded) onCountChange?.(visible.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, visible.length]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  function act(n: Nudge) {
    close();
    router.push(n.href);
  }

  function dismiss(n: Nudge) {
    setDismissed((prev) => new Set(prev).add(nudgeKey(n)));
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="steward-app fixed inset-0 z-50" onClick={close} role="presentation" />
      <div
        className="steward-app fixed right-4 top-14 z-[51] w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-line-2 bg-surface shadow-sh-pop"
        role="dialog"
        aria-modal="true"
        aria-label="Nudges from Steward"
      >
        <div className="flex items-center gap-[9px] border-b border-line px-[18px] py-[15px]">
          <Bell className="h-[17px] w-[17px] text-brand" aria-hidden />
          <span className="flex-1 text-[14px] font-bold text-ink">Nudges from Steward</span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-ink-3 transition-colors hover:bg-surface-2"
          >
            <X className="h-[15px] w-[15px]" aria-hidden />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {visible.length > 0 ? (
            visible.map((n) => (
              <div
                key={nudgeKey(n)}
                className="mb-2 flex gap-[11px] rounded-lg border border-line bg-surface p-3"
              >
                <span className="mt-1 h-2 w-2 shrink-0 rounded-pill bg-attention" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 text-[13px] font-semibold text-ink">{n.title}</div>
                  <div className="mb-[9px] text-[12px] leading-[1.45] text-ink-2">{n.body}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => act(n)}
                      className="rounded-[6px] bg-brand px-[11px] py-1.5 text-[12px] font-semibold text-on-brand transition-colors hover:bg-brand-2"
                    >
                      {n.act}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(n)}
                      className="rounded-[6px] px-2 py-1.5 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-surface-2"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="px-5 py-[34px] text-center">
              <div className="mx-auto mb-3 grid h-[42px] w-[42px] place-items-center rounded-pill bg-brand-weak text-brand">
                <CheckCircle2 className="h-[22px] w-[22px]" aria-hidden />
              </div>
              <div className="text-[13px] text-ink-2">You&apos;re all caught up — nothing slipping.</div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
