import type { UsageFeatureRow } from "@/lib/usage";

export function UsageFeatureTable({
  rows,
  total,
}: {
  rows: UsageFeatureRow[];
  total: { calls: string; cost: string };
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center border-b border-line px-[18px] py-3.5 font-mono text-[10px] uppercase tracking-wider text-ink-4">
        <span className="flex-1">Feature</span>
        <span className="w-[120px] text-right">Calls</span>
        <span className="w-[120px] text-right">Cost</span>
      </div>
      {rows.map((f) => (
        <div key={f.label} className="flex items-center border-b border-line px-[18px] py-3.5">
          <span className="flex flex-1 items-center gap-2.5">
            <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: f.tone }} />
            <span className="text-[13.5px] font-semibold capitalize text-ink">{f.label}</span>
          </span>
          <span className="w-[120px] text-right font-mono text-[13px] text-ink-2">{f.calls}</span>
          <span className="w-[120px] text-right font-mono text-[13px] font-semibold text-ink">${f.cost}</span>
        </div>
      ))}
      <div className="flex items-center bg-surface-2 px-[18px] py-3.5">
        <span className="flex-1 text-[13.5px] font-bold text-ink">Total</span>
        <span className="w-[120px] text-right font-mono text-[13px] text-ink-3">{total.calls}</span>
        <span className="w-[120px] text-right font-mono text-[14px] font-bold text-brand-ink">{total.cost}</span>
      </div>
    </div>
  );
}
