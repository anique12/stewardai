import { cn } from "@/lib/utils";

export interface SpaceChipProps {
  name: string;
  className?: string;
}

export function SpaceChip({ name, className }: SpaceChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border border-brand-weak-2 bg-surface px-[7px] py-[1px] font-mono text-[9.5px] font-semibold text-brand",
        className
      )}
    >
      {name}
    </span>
  );
}
