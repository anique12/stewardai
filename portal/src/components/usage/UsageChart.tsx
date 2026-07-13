import type { UsagePerWeekBar } from "@/lib/usage";

const LEGEND: { label: string; c: string }[] = [
  { label: "Chat", c: "var(--brand)" },
  { label: "Ask", c: "var(--attention)" },
  { label: "Summary", c: "var(--ink-3)" },
];

export function UsageChart({ bars }: { bars: UsagePerWeekBar[] }) {
  return (
    <div className="mb-[22px] rounded-xl border border-line bg-surface p-5">
      <div className="mb-[18px] flex items-center gap-3.5">
        <span className="flex-1 text-sm font-bold text-ink">Meetings processed per week</span>
        <div className="flex gap-3">
          {LEGEND.map((lg) => (
            <span key={lg.label} className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
              <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: lg.c }} />
              {lg.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex h-[180px] items-end justify-around gap-5 pt-2">
        {bars.map((b, i) => (
          <div key={i} className="flex max-w-[90px] flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-col items-center justify-end">
              <div className="w-11 rounded-t-[5px] bg-ink-3" style={{ height: `${b.sumH}px` }} />
              <div className="w-11 bg-attention" style={{ height: `${b.askH}px` }} />
              <div className="w-11 rounded-b-[5px] bg-brand" style={{ height: `${b.chatH}px` }} />
            </div>
            <span className="font-mono text-[10.5px] text-ink-3">{b.d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
