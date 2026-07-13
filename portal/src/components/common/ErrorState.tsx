import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title: ReactNode;
  body?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "mx-auto max-w-[520px] px-[30px] py-[90px] text-center",
        className
      )}
    >
      <div className="mx-auto mb-[18px] flex h-[52px] w-[52px] items-center justify-center rounded-lg bg-danger-weak text-danger-strong">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 8v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1.2" fill="currentColor" />
        </svg>
      </div>
      <h2 className="mb-2 font-display text-xl font-bold tracking-tight">
        {title}
      </h2>
      {body && (
        <p className="mx-auto mb-[22px] max-w-[420px] text-sm leading-relaxed text-ink-2">
          {body}
        </p>
      )}
      {onRetry && (
        <Button onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
