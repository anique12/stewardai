import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cleanTldr } from "@/lib/meetings/tldr";
import { SpaceChip } from "@/components/common/SpaceChip";
import { StatusPill, type StatusPillStatus } from "@/components/common/StatusPill";
import { AttendeeAvatars } from "@/components/common/AttendeeAvatars";
import type { MeetingListItem } from "@/lib/meetings/series";

const KNOWN_STATUSES: StatusPillStatus[] = ["in_meeting", "done", "failed", "scheduled", "pending"];

// Pin locale + timeZone so server (Node/UTC) and client (browser-local) render
// identical strings — otherwise React throws a hydration mismatch (see the same
// note in UpcomingGroups.timeParts).
function dayLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
}
function timeLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone });
}

export type PastMeeting = MeetingListItem & { space_id?: string | null };

export function PastList({
  meetings,
  spaceNameById,
  actionCountById,
  timeZone,
}: {
  meetings: PastMeeting[];
  spaceNameById: Record<string, string>;
  actionCountById: Record<string, number>;
  timeZone: string;
}) {
  if (meetings.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-3">No past meetings yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-[13px] border border-line bg-surface">
      {meetings.map((m) => {
        const summary = cleanTldr(m.tldr);
        const spaceName = m.space_id ? spaceNameById[m.space_id] : undefined;
        const actionCount = actionCountById[m.id] ?? 0;
        const status = KNOWN_STATUSES.includes(m.bot_status as StatusPillStatus)
          ? (m.bot_status as StatusPillStatus)
          : "done";

        return (
          <Link
            key={m.id}
            href={`/app/meetings/${m.id}`}
            className="flex items-center gap-[15px] border-b border-line px-[18px] py-[15px] last:border-0 hover:bg-surface-2"
          >
            <div className="w-[60px] shrink-0 text-center">
              <div className="font-mono text-[11px] text-ink-3">{dayLabel(m.start_time, timeZone)}</div>
              <div className="font-mono text-[13px] font-semibold">{timeLabel(m.start_time, timeZone)}</div>
            </div>
            <div className="h-10 w-px shrink-0 bg-line" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold">{m.title}</span>
                {spaceName ? <SpaceChip name={spaceName} /> : null}
              </div>
              <div className="mt-1 max-w-[560px] truncate text-[12px] text-ink-3">
                {summary ?? "No summary"}
              </div>
            </div>
            <AttendeeAvatars attendees={m.attendees} max={3} size={22} />
            {actionCount > 0 ? (
              <span className="shrink-0 rounded-pill border border-line-2 bg-surface-2 px-2 py-[3px] font-mono text-[10px] font-semibold text-ink-3">
                {actionCount} action{actionCount === 1 ? "" : "s"}
              </span>
            ) : null}
            <StatusPill status={status} />
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
