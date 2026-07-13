"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Two-column layout at lg+ (both transcript and recap always visible); below
// that, a segmented control switches which one is shown. Purely a display
// concern — both panes are always mounted, so live polling inside the
// transcript pane keeps running regardless of which tab is active.
export function MeetingDetailTabs({
  transcript,
  recap,
}: {
  transcript: React.ReactNode;
  recap: React.ReactNode;
}) {
  const [tab, setTab] = useState<"transcript" | "recap">("transcript");

  return (
    <div>
      <div className="mt-4 flex gap-[3px] rounded-md border border-line bg-surface-2 p-[3px] lg:hidden">
        <button
          type="button"
          onClick={() => setTab("transcript")}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
            tab === "transcript" ? "bg-surface text-ink shadow-sh-1" : "text-ink-3 hover:text-ink"
          )}
        >
          Transcript
        </button>
        <button
          type="button"
          onClick={() => setTab("recap")}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
            tab === "recap" ? "bg-surface text-ink shadow-sh-1" : "text-ink-3 hover:text-ink"
          )}
        >
          Recap
        </button>
      </div>

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12">
        <section className={cn(tab === "transcript" ? "block" : "hidden", "lg:block")}>{transcript}</section>
        <aside className={cn(tab === "recap" ? "block" : "hidden", "lg:block")}>{recap}</aside>
      </div>
    </div>
  );
}
