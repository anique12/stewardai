import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  label: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function SectionCard({
  label,
  actions,
  children,
  className,
  bodyClassName,
}: SectionCardProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-line bg-surface shadow-sh-1",
        className
      )}
    >
      <div className="flex items-center gap-[9px] border-b border-line px-4 py-[14px]">
        <span className="font-display text-[13px] font-bold">{label}</span>
        <span className="flex-1" />
        {actions}
      </div>
      <div className={cn(bodyClassName)}>{children}</div>
    </div>
  );
}
