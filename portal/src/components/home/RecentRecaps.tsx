import Link from "next/link";
import { SectionCard } from "@/components/common/SectionCard";
import { SpaceChip } from "@/components/common/SpaceChip";
import { recapDateLabel, type HomeRecapRow } from "@/lib/home";

export function RecentRecaps({ recaps, timeZone }: { recaps: HomeRecapRow[]; timeZone: string }) {
  return (
    <SectionCard label="Recent recaps">
      {recaps.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">No recaps yet — they&apos;ll show up after your meetings finish.</p>
      ) : (
        recaps.map((r) => (
          <Link
            key={r.meeting_id}
            href={`/app/meetings/${r.meeting_id}`}
            className="flex gap-3 border-b border-line px-4 py-[13px] last:border-0 hover:bg-surface-2"
          >
            <span className="mt-px flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-brand-weak text-brand">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 3.5h9l4 4V20a1 1 0 01-1 1H6a1 1 0 01-1-1V4.5a1 1 0 011-1z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path d="M8 11h8M8 14h8M8 17h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-semibold">{r.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-4">{recapDateLabel(r.start_time, timeZone)}</span>
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-2">{r.tldr}</span>
              {r.space_name ? (
                <span className="mt-1.5 inline-block">
                  <SpaceChip name={r.space_name} />
                </span>
              ) : null}
            </span>
          </Link>
        ))
      )}
    </SectionCard>
  );
}
