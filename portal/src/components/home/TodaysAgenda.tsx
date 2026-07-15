import Link from "next/link";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { toStatusPillStatus } from "@/lib/meetings/status-pill";
import type { HomeMeetingRow } from "@/lib/home";

function platformFromUrl(url: string | null): string {
  if (!url) return "No link";
  if (url.includes("zoom.us")) return "Zoom";
  if (url.includes("meet.google.com")) return "Google Meet";
  if (url.includes("teams.microsoft.com")) return "Teams";
  return "Video call";
}

function timeParts(iso: string): { time: string; ampm: string } {
  const label = new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const [time, ampm] = label.split(" ");
  return { time, ampm: ampm ?? "" };
}

export function TodaysAgenda({ meetings }: { meetings: HomeMeetingRow[] }) {
  return (
    <SectionCard
      label="Today's agenda"
      actions={
        <Link href="/app/meetings" className="text-xs font-semibold text-brand hover:underline">
          All meetings →
        </Link>
      }
    >
      {meetings.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">Nothing on the calendar for today.</p>
      ) : (
        meetings.map((m) => {
          const { time, ampm } = timeParts(m.start_time);
          const status = toStatusPillStatus(m.bot_status, "scheduled");
          return (
            <Link
              key={m.id}
              href={`/app/meetings/${m.id}`}
              className="flex items-center gap-[13px] border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2"
            >
              <span className="w-[52px] shrink-0 text-right">
                <span className="block font-mono text-[13px] font-semibold">{time}</span>
                <span className="block font-mono text-[9px] text-ink-4">{ampm}</span>
              </span>
              <span className="h-[30px] w-px bg-line" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{m.title}</span>
                <span className="block text-[11.5px] text-ink-3">{platformFromUrl(m.meet_url)}</span>
              </span>
              <StatusPill status={status} />
            </Link>
          );
        })
      )}
    </SectionCard>
  );
}
