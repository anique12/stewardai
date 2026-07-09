import Link from "next/link";
import { cleanTldr } from "@/lib/meetings/tldr";
import type { MeetingListItem } from "@/lib/meetings/series";

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// One Past row — the whole card links to the meeting. Shows a real one-line
// summary when there is one, otherwise a quiet "No summary" (never the LLM's
// "no transcript provided" refusal text).
export function PastMeetingRow({ meeting }: { meeting: MeetingListItem }) {
  const summary = cleanTldr(meeting.tldr);
  return (
    <Link
      href={`/app/meetings/${meeting.id}`}
      className="flex items-start gap-4 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-secondary/40"
    >
      <div className="w-14 shrink-0 text-center">
        <div className="text-xs font-semibold text-foreground">{dayLabel(meeting.start_time)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{meeting.title}</p>
        {summary ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{summary}</p>
        ) : (
          <p className="mt-0.5 text-xs italic text-muted-foreground">No summary</p>
        )}
      </div>
    </Link>
  );
}
