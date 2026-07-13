import { cn } from "@/lib/utils";

export type Platform = "Google Meet" | "Zoom" | "Teams" | (string & {});

// Meeting-platform brand colors are deliberately kept as raw hex rather than
// paper design tokens — they identify a third-party product and should read
// the same regardless of light/dark theme.
const PLATFORM_COLORS: Record<string, string> = {
  Zoom: "#2D8CFF",
  "Google Meet": "#00897B",
  Meet: "#00897B",
  Teams: "#5059C9",
};

export interface PlatformChipProps {
  platform: Platform;
  className?: string;
}

export function PlatformChip({ platform, className }: PlatformChipProps) {
  const color = PLATFORM_COLORS[platform] ?? "var(--ink-3)";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[6px] font-mono text-[11px] font-semibold",
        className
      )}
      style={{ color }}
    >
      <span
        className="h-[6px] w-[6px] shrink-0 rounded-pill"
        style={{ background: color }}
      />
      {platform}
    </span>
  );
}
