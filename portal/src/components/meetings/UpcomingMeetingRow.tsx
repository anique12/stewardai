import { OptInToggle } from "./OptInToggle";
import type { UpcomingRow } from "@/lib/meetings/series";

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// One Upcoming row. A recurring series (seriesCount > 1) shows its cadence +
// series size as a quiet hint; a one-off shows a Join link when it has a URL.
export function UpcomingMeetingRow({ row }: { row: UpcomingRow }) {
  const { meeting, seriesCount, cadence } = row;
  const isSeries = seriesCount > 1;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="w-14 shrink-0 text-center">
        <div className="text-xs font-semibold text-foreground">{dayLabel(meeting.start_time)}</div>
        <div className="text-[11px] tabular-nums text-muted-foreground">{timeLabel(meeting.start_time)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{meeting.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isSeries
            ? `${cadence ?? "Recurring"} · ${seriesCount} in series`
            : meeting.meet_url
              ? (
                <a
                  href={meeting.meet_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Join ↗
                </a>
              )
              : "One-off"}
        </p>
      </div>
      <div className="ml-2 shrink-0">
        <OptInToggle meetingId={meeting.id} initialValue={meeting.opted_in} />
      </div>
    </div>
  );
}
