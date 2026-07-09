import { OptInToggle } from "./OptInToggle";
import { StatusBadge } from "./StatusBadge";
import Link from "next/link";

type Meeting = {
  id: string;
  title: string;
  start_time: string;
  meet_url: string | null;
  opted_in: boolean;
  bot_status: string;
  tldr?: string | null;
};

export function MeetingRow({ meeting, isPast }: { meeting: Meeting; isPast: boolean }) {
  const start = new Date(meeting.start_time);
  const day = start.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const body = (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-secondary/40">
      <div className="w-14 shrink-0 text-center">
        <div className="text-xs font-semibold text-foreground">{day}</div>
        <div className="text-[11px] tabular-nums text-muted-foreground">{time}</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{meeting.title}</p>
        {meeting.tldr ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{meeting.tldr}</p>
        ) : !isPast && meeting.meet_url ? (
          <a href={meeting.meet_url} target="_blank" rel="noopener noreferrer"
            className="mt-0.5 inline-block text-sm text-primary hover:underline">Join ↗</a>
        ) : null}
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-3">
        <StatusBadge status={meeting.bot_status} />
        {!isPast && <OptInToggle meetingId={meeting.id} initialValue={meeting.opted_in} />}
      </div>
    </div>
  );

  return isPast ? (
    <Link href={`/app/meetings/${meeting.id}`} className="block">{body}</Link>
  ) : (
    body
  );
}
