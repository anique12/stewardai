"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BarChart3, ChevronsUpDown, LogOut, Moon, Settings, Sun } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "./ThemeProvider";
import { useSettingsModal } from "./SettingsModalContext";
import { PersonAvatar } from "@/components/common/PersonAvatar";

export function UserMenu({
  email,
  avatarUrl,
  className,
}: {
  email: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { openSettings } = useSettingsModal();
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  async function signOut() {
    setBusy(true);
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-[9px] py-2 text-left text-ink transition-colors hover:bg-surface-2",
            className
          )}
        >
          <PersonAvatar name={email.split("@")[0]} email={email} photoUrl={avatarUrl} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{email.split("@")[0]}</span>
            <span className="block truncate text-[11px] text-ink-3">{email}</span>
          </span>
          <ChevronsUpDown className="h-[15px] w-[15px] shrink-0 text-ink-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-60 rounded-lg border-line-2 p-1.5 shadow-sh-pop">
        <div className="border-b border-line px-2.5 py-2 pb-2">
          <div className="truncate text-[12.5px] font-semibold text-ink">{email.split("@")[0]}</div>
          <div className="truncate text-[11px] text-ink-3">{email}</div>
        </div>
        <DropdownMenuItem onClick={openSettings} className="cursor-pointer rounded-md text-[13px]">
          <Settings className="mr-2 h-4 w-4 text-ink-3" aria-hidden />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer rounded-md text-[13px]">
          <Link href="/app/usage">
            <BarChart3 className="mr-2 h-4 w-4 text-ink-3" aria-hidden />
            Usage &amp; billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => { e.preventDefault(); toggle(); }}
          className="cursor-pointer rounded-md text-[13px]"
        >
          {isDark ? (
            <Sun className="mr-2 h-4 w-4 text-ink-3" aria-hidden />
          ) : (
            <Moon className="mr-2 h-4 w-4 text-ink-3" aria-hidden />
          )}
          Switch to {isDark ? "light" : "dark"} theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={signOut}
          disabled={busy}
          className="cursor-pointer rounded-md text-[13px] text-danger-strong focus:bg-danger-weak focus:text-danger-strong"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden /> {busy ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
