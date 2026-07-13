"use client";

import { Menu, Search, Radio, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

export function Topbar({
  title,
  subtitle,
  nudgeCount = 0,
  onOpenDrawer,
  onOpenSearch,
  onOpenInstantJoin,
  onOpenNudges,
}: {
  title: string;
  subtitle?: string;
  nudgeCount?: number;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onOpenInstantJoin: () => void;
  onOpenNudges: () => void;
}) {
  return (
    <header className="flex h-[62px] shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3.5 sm:px-5">
      <button
        type="button"
        aria-label="Open menu"
        onClick={onOpenDrawer}
        className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md text-ink transition-colors hover:bg-surface-2 lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      <div className="flex min-w-0 flex-col justify-center">
        <div className="truncate font-display text-[17px] font-bold leading-tight tracking-tight text-ink">{title}</div>
        {subtitle ? <div className="truncate text-[11.5px] text-ink-3">{subtitle}</div> : null}
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden w-[270px] items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-[7px] text-left text-ink-3 transition-colors hover:bg-surface-3 lg:flex"
      >
        <Search className="h-[15px] w-[15px] shrink-0" aria-hidden />
        <span className="flex-1 text-[12.5px]">Search meetings, people, facts…</span>
        <span className="rounded border border-line-2 px-[5px] py-px font-mono text-[10px] text-ink-4">⌘K</span>
      </button>

      <button
        type="button"
        onClick={onOpenInstantJoin}
        className="flex shrink-0 items-center gap-[7px] rounded-md bg-brand px-[13px] py-2 text-[12.5px] font-semibold text-on-brand shadow-sh-1 transition-colors hover:bg-brand-2"
      >
        <Radio className="h-[15px] w-[15px]" aria-hidden />
        <span className="hidden sm:inline">Instant join</span>
      </button>

      <button
        type="button"
        title="Nudges"
        onClick={onOpenNudges}
        className="relative grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2"
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {nudgeCount > 0 ? (
          <span
            className={cn(
              "absolute right-[6px] top-[5px] flex h-[15px] min-w-[15px] items-center justify-center rounded-pill border-[1.5px] border-surface bg-attention px-[3px] font-mono text-[9px] font-bold text-on-attention"
            )}
          >
            {nudgeCount}
          </span>
        ) : null}
      </button>

      <ThemeToggle />
    </header>
  );
}
