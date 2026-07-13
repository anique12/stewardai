"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./ThemeProvider";

/**
 * Theme switcher. Defaults to a compact icon-only button (Topbar usage);
 * pass `label` to render a full text menu item (account menu usage).
 */
export function ThemeToggle({ label, className }: { label?: boolean; className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  if (label) {
    return (
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-surface-2",
          className
        )}
      >
        {isDark ? <Sun className="h-4 w-4 text-ink-3" aria-hidden /> : <Moon className="h-4 w-4 text-ink-3" aria-hidden />}
        Switch to {isDark ? "light" : "dark"} theme
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Toggle theme"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2",
        className
      )}
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
    </button>
  );
}
