import { cn } from "@/lib/utils";

export type ConfidenceLevel = "high" | "medium" | "low";

const CONFIDENCE_CONFIG: Record<
  ConfidenceLevel,
  { label: string; className: string }
> = {
  high: {
    label: "High confidence",
    className: "text-brand bg-surface border-brand-weak-2",
  },
  medium: {
    label: "Medium confidence",
    className: "text-attention-strong bg-surface border-attention-weak",
  },
  low: {
    label: "Low confidence",
    className: "text-ink-3 bg-surface border-line-2",
  },
};

export interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  className?: string;
}

export function ConfidenceBadge({ level, className }: ConfidenceBadgeProps) {
  const config = CONFIDENCE_CONFIG[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] rounded-pill border px-2 py-0.5 font-mono text-[9.5px] font-semibold",
        config.className,
        className
      )}
    >
      {level === "high" ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12l4.5 4.5L19 7"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span className="h-[5px] w-[5px] rounded-pill bg-current" />
      )}
      {config.label}
    </span>
  );
}
