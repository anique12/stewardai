import { cn } from "@/lib/utils";

export type StatusPillStatus =
  | "joining"
  | "in_meeting"
  | "done"
  | "failed"
  | "scheduled"
  | "pending";

const STATUS_CONFIG: Record<
  StatusPillStatus,
  { label: string; className: string; pulse?: boolean }
> = {
  joining: {
    // Bot dispatched — asking to join / waiting in the lobby, NOT yet admitted.
    // Pulses to read as in-progress, but distinct from the brand "Live" tone.
    label: "Joining",
    className: "text-attention-strong bg-attention-weak border-attention-weak",
    pulse: true,
  },
  in_meeting: {
    label: "Live",
    className: "text-brand bg-brand-weak border-brand-weak-2",
    pulse: true,
  },
  done: {
    label: "Completed",
    className: "text-ink-3 bg-surface-2 border-line",
  },
  failed: {
    label: "Failed",
    className: "text-danger-strong bg-danger-weak border-danger-weak",
  },
  scheduled: {
    label: "Scheduled",
    className: "text-ink-4 bg-surface-2 border-line",
  },
  pending: {
    label: "Pending",
    className: "text-attention-strong bg-attention-weak border-attention-weak",
  },
};

export interface StatusPillProps {
  status: StatusPillStatus;
  className?: string;
}

export function StatusPill({ status, className }: StatusPillProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] rounded-pill border px-2 py-[3px] font-mono text-[9.5px] font-semibold",
        config.className,
        className
      )}
    >
      <span
        className={cn(
          "h-[5px] w-[5px] rounded-pill bg-current",
          config.pulse && "anim-pulse"
        )}
      />
      {config.label}
    </span>
  );
}
