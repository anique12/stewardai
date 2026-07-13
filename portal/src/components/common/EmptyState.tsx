import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto max-w-[560px] px-[30px] py-[70px] text-center",
        className
      )}
    >
      {icon && (
        <div className="mx-auto mb-5 flex h-[60px] w-[60px] items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sh-2">
          {icon}
        </div>
      )}
      <h2 className="mb-[10px] font-display text-2xl font-bold tracking-tight">
        {title}
      </h2>
      {body && (
        <p className="mx-auto mb-6 max-w-[400px] text-sm leading-relaxed text-ink-2">
          {body}
        </p>
      )}
      {action}
    </div>
  );
}
