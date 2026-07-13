import Link from "next/link";
import { cn } from "@/lib/utils";

export type MeetingsTab = "upcoming" | "past";

export function MeetingsHeader({
  dateLabel,
  liveCount,
  upcomingTodayCount,
  tab,
}: {
  dateLabel: string;
  liveCount: number;
  upcomingTodayCount: number;
  tab: MeetingsTab;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-4">
      <div className="min-w-[200px] flex-1">
        <h1 className="mb-[3px] font-display text-2xl font-bold tracking-tight">Meetings</h1>
        <p className="text-[13px] text-ink-3">
          {dateLabel}
          {liveCount > 0 ? (
            <>
              {" · "}
              <span className="font-semibold text-brand">
                {liveCount} live now
              </span>
            </>
          ) : null}
          {" · "}
          {upcomingTodayCount} upcoming today
        </p>
      </div>
      <div className="flex rounded-md border border-line bg-surface-2 p-[3px]">
        <Link
          href="/app/meetings?tab=upcoming"
          aria-current={tab === "upcoming" ? "page" : undefined}
          className={cn(
            "rounded px-3 py-1.5 text-[13px] font-semibold transition-colors",
            tab === "upcoming" ? "bg-surface text-ink shadow-sh-1" : "text-ink-3 hover:text-ink"
          )}
        >
          Upcoming
        </Link>
        <Link
          href="/app/meetings?tab=past"
          aria-current={tab === "past" ? "page" : undefined}
          className={cn(
            "rounded px-3 py-1.5 text-[13px] font-semibold transition-colors",
            tab === "past" ? "bg-surface text-ink shadow-sh-1" : "text-ink-3 hover:text-ink"
          )}
        >
          Past
        </Link>
      </div>
    </div>
  );
}
