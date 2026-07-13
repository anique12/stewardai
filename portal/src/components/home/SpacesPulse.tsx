import Link from "next/link";
import type { HomeSpaceRow } from "@/lib/home";

export function SpacesPulse({ spaces }: { spaces: HomeSpaceRow[] }) {
  const max = Math.max(1, ...spaces.map((s) => s.open));

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sh-1">
      <div className="mb-[14px] flex items-center gap-[9px]">
        <span className="font-display text-[13px] font-bold">Spaces pulse</span>
        <span className="flex-1" />
        <Link href="/app/spaces" className="text-xs font-semibold text-brand hover:underline">
          All →
        </Link>
      </div>
      {spaces.length === 0 ? (
        <p className="text-sm text-ink-3">No spaces yet.</p>
      ) : (
        <div className="flex flex-col gap-[13px]">
          {spaces.map((sp) => (
            <Link key={sp.id} href={`/app/spaces/${sp.id}`} className="block hover:opacity-80">
              <div className="mb-[5px] flex items-center gap-2">
                <span className="flex-1 truncate text-[13px] font-semibold">{sp.name}</span>
                <span className="font-mono text-[10.5px] font-semibold text-attention">{sp.open} open</span>
              </div>
              <div className="h-[5px] overflow-hidden rounded-pill bg-surface-2">
                <div
                  className="h-full rounded-pill bg-attention"
                  style={{ width: `${Math.round((sp.open / max) * 100)}%` }}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
