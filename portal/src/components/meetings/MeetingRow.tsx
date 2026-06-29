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
};

export function MeetingRow({ meeting, isPast }: { meeting: Meeting; isPast: boolean }) {
  const start = new Date(meeting.start_time);
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{meeting.title}</p>
        <p className="text-sm text-muted-foreground">
          {start.toLocaleDateString()} · {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {meeting.meet_url && (
            <a href={meeting.meet_url} target="_blank" rel="noopener noreferrer"
              className="ml-2 text-primary underline-offset-2 hover:underline">
              Join
            </a>
          )}
        </p>
      </div>
      <div className="ml-4 flex items-center gap-3">
        <StatusBadge status={meeting.bot_status} />
        {isPast ? (
          <Link href={`/app/meetings/${meeting.id}`}
            className="text-sm text-primary hover:underline">
            View results
          </Link>
        ) : (
          <OptInToggle meetingId={meeting.id} initialValue={meeting.opted_in} />
        )}
      </div>
    </div>
  );
}
