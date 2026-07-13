import Link from "next/link";
import { cn } from "@/lib/utils";
import type { UsageRange } from "@/lib/usage";

const RANGES: UsageRange[] = [7, 30, 90];

export function UsageRangeToggle({ range }: { range: UsageRange }) {
  return (
    <div className="flex rounded-md border border-line bg-surface-2 p-[3px]">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`/app/usage?range=${r}`}
          aria-current={range === r ? "page" : undefined}
          className={cn(
            "rounded px-3 py-1.5 text-[13px] font-semibold transition-colors",
            range === r ? "bg-surface text-ink shadow-sh-1" : "text-ink-3 hover:text-ink"
          )}
        >
          {r}d
        </Link>
      ))}
    </div>
  );
}
