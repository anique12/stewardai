import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SpaceChipProps {
  name: string;
  className?: string;
  /** Optional leading icon (e.g. a small glyph) shown before the name. */
  icon?: ReactNode;
  /** When set, renders the chip as a link to this href. */
  href?: string;
  /**
   * "sm" (default) is the compact tag-style chip used in meeting lists.
   * "md" is the larger, bolder chip used as a primary indicator (e.g. the
   * filed-space chip on the meeting detail page).
   */
  size?: "sm" | "md";
}

export function SpaceChip({ name, className, icon, href, size = "sm" }: SpaceChipProps) {
  const content = (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border font-semibold",
        size === "md"
          ? "gap-[7px] border-brand-weak-2 bg-brand-weak px-2.5 py-[5px] text-[12.5px] text-brand-ink transition-colors hover:bg-brand-weak-2"
          : "border-brand-weak-2 bg-surface px-[7px] py-[1px] font-mono text-[9.5px] text-brand",
        className
      )}
    >
      {icon}
      {name}
    </span>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
