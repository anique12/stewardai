"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { SeriesEntry } from "@/lib/meetings/series";
import { cadenceLabel } from "@/lib/meetings/cadence";
import { OptInToggle } from "./OptInToggle";
import { StatusBadge } from "./StatusBadge";

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SeriesCard({ entry }: { entry: SeriesEntry }) {
  const [open, setOpen] = useState(false);
  const cadence = cadenceLabel(entry.occurrences.map((o) => o.start_time));

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{entry.title}</span>
          <span className="block text-xs text-muted-foreground">
            {cadence}
            {entry.nextOccurrence
              ? ` · next ${dateLabel(entry.nextOccurrence.start_time)}`
              : " · no upcoming"}
            {` · ${entry.count} meetings`}
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-4 py-3">
          {entry.upcoming.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</h4>
              <ul className="space-y-1.5">
                {entry.upcoming.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground/90">
                      {dateLabel(o.start_time)} · {timeLabel(o.start_time)}
                    </span>
                    <OptInToggle meetingId={o.id} initialValue={o.opted_in} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {entry.past.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Past</h4>
              <ul className="space-y-2">
                {entry.past.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground/90">{dateLabel(o.start_time)}</p>
                      {o.tldr ? <p className="truncate text-xs text-muted-foreground">{o.tldr}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={o.bot_status} />
                      <Link href={`/app/meetings/${o.id}`} className="text-sm text-primary hover:underline">View</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
