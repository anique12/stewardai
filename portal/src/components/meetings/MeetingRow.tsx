import Link from "next/link";
import { OptInToggle } from "./OptInToggle";
import { StatusPill } from "@/components/common/StatusPill";
import { toStatusPillStatus } from "@/lib/meetings/status-pill";

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
  const status = toStatusPillStatus(meeting.bot_status);

  const body = (
    <div className="flex items-start gap-[13px] border-b border-line px-4 py-[13px] transition-colors last:border-0 hover:bg-surface-2">
      <div className="w-[68px] shrink-0 text-center">
        <div className="whitespace-nowrap font-mono text-[11px] text-ink-3">{day}</div>
        <div className="whitespace-nowrap font-mono text-[11px] font-semibold text-ink">{time}</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-ink">{meeting.title}</p>
        {meeting.tldr ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{meeting.tldr}</p>
        ) : !isPast && meeting.meet_url ? (
          <a
            href={meeting.meet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-block text-[12px] text-brand hover:underline"
          >
            Join ↗
          </a>
        ) : null}
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-2.5">
        <StatusPill status={status} />
        {!isPast && <OptInToggle meetingId={meeting.id} initialValue={meeting.opted_in} />}
      </div>
    </div>
  );

  return isPast ? (
    <Link href={`/app/meetings/${meeting.id}`} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
