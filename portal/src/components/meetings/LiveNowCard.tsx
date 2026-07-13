import Link from "next/link";

export type LiveMeeting = {
  id: string;
  title: string;
  start_time: string;
};

// "Happening now" is elapsed at the moment this (force-dynamic) page
// rendered — good enough for a badge that reloads on every navigation,
// without wiring up client-side ticking for a single number.
function elapsedLabel(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m elapsed` : `${m}m elapsed`;
}

export function LiveNowCard({ meeting }: { meeting: LiveMeeting }) {
  return (
    <Link
      href={`/app/meetings/${meeting.id}`}
      className="mb-[22px] block rounded-2xl border-[1.5px] border-brand bg-gradient-to-b from-brand-weak to-surface p-4 shadow-sh-1 transition-opacity hover:opacity-95"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="relative inline-flex h-[10px] w-[10px] shrink-0 items-center justify-center">
          <span className="anim-ring absolute h-[10px] w-[10px] rounded-pill bg-brand" aria-hidden />
          <span className="h-2 w-2 rounded-pill bg-brand" aria-hidden />
        </span>
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-brand">
          Happening now · Steward in room
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[11.5px] text-ink-3">{elapsedLabel(meeting.start_time)}</span>
      </div>
      <div className="mt-[11px] flex flex-wrap items-center gap-3.5">
        <div className="min-w-[200px] flex-1">
          <div className="font-display text-[17px] font-bold">{meeting.title}</div>
          <div className="mt-1 text-[12.5px] italic text-ink-2">
            Steward is transcribing this meeting live.
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-md bg-brand px-4 py-2 text-[13.5px] font-semibold text-on-brand shadow-sh-1">
          Open live transcript
        </span>
      </div>
    </Link>
  );
}
