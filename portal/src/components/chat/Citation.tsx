"use client";

// A `[n]` citation chip: hover/focus reveals a small popover with the cited
// snippet, kind, and meeting; clicking jumps to that meeting's page. Ported
// from the approved mockup's `.cite` / `.cite-pop` styling.

import { useRouter } from "next/navigation";
import type { Citation as CitationType } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

export function Citation({ citation, label }: { citation: CitationType; label?: number }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(`/app/meetings/${citation.meeting_id}`)}
      className={cn(
        "group relative mx-0.5 inline-flex h-[15px] min-w-[15px] translate-y-[2px] cursor-pointer select-none appearance-none",
        "items-center justify-center rounded-[5px] border-0 bg-brand-weak px-[3px] text-[10px] font-semibold leading-none",
        "tabular-nums text-brand outline-none transition-colors hover:bg-brand-weak-2 focus-visible:bg-brand-weak-2",
      )}
    >
      {label ?? citation.n}
      <span
        className={cn(
          "steward-app pointer-events-none invisible absolute bottom-[calc(100%+9px)] left-1/2 z-30 w-[270px] -translate-x-1/2",
          "translate-y-1 rounded-xl border border-line-2 bg-surface p-3 text-left font-normal normal-case text-ink",
          "opacity-0 shadow-sh-2 transition-[opacity,transform] duration-150",
          "group-hover:visible group-hover:translate-y-0 group-hover:opacity-100",
          "group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
        )}
      >
        <span className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[10.5px] uppercase tracking-wide text-ink-4">
          <span className="text-brand">{citation.kind}</span>
          <span className="truncate">{citation.meeting_id.slice(0, 8)}</span>
        </span>
        {citation.text ? (
          <span className="block text-[12.5px] leading-snug text-ink-2">{citation.text}</span>
        ) : (
          <span className="block text-[12.5px] italic leading-snug text-ink-3">No preview available</span>
        )}
        <span className="mt-2 block border-t border-line pt-2 text-[11.5px] font-medium text-brand">
          Open meeting →
        </span>
      </span>
    </button>
  );
}
