"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { SeriesEntry } from "@/lib/meetings/series";
import { cadenceLabel } from "@/lib/meetings/cadence";
import { OptInToggle } from "./OptInToggle";
import { StatusPill } from "@/components/common/StatusPill";
import { toStatusPillStatus } from "@/lib/meetings/status-pill";

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
    <div className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-[13px] text-left transition-colors hover:bg-surface-2"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-ink">{entry.title}</span>
          <span className="block font-mono text-[11px] text-ink-3">
            {cadence}
            {entry.nextOccurrence
              ? ` · next ${dateLabel(entry.nextOccurrence.start_time)}`
              : " · no upcoming"}
            {` · ${entry.count} meetings`}
          </span>
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 bg-surface-2/50 px-4 py-3">
          {entry.upcoming.length > 0 && (
            <div>
              <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                Upcoming
              </h4>
              <ul className="flex flex-col gap-1.5">
                {entry.upcoming.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-ink-2">
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
              <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                Past
              </h4>
              <ul className="flex flex-col gap-2">
                {entry.past.map((o) => {
                  const status = toStatusPillStatus(o.bot_status);
                  return (
                    <li key={o.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] text-ink-2">{dateLabel(o.start_time)}</p>
                        {o.tldr ? <p className="truncate text-[12px] text-ink-3">{o.tldr}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusPill status={status} />
                        <Link href={`/app/meetings/${o.id}`} className="text-[13px] text-brand hover:underline">
                          View
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
