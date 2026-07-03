"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Blocks, Settings, Menu, X } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: (path: string) => boolean;
};

const NAV: NavItem[] = [
  { href: "/app", label: "Meetings", icon: CalendarClock, isActive: (p) => p === "/app" || p.startsWith("/app/meetings") },
  { href: "/app/settings/connections", label: "Connected Apps", icon: Blocks, isActive: (p) => p.startsWith("/app/settings/connections") },
  { href: "/app/settings", label: "Settings", icon: Settings, isActive: (p) => p === "/app/settings" },
];

function Wordmark() {
  return (
    <Link href="/app" className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/15">
        <span className="h-3 w-3 rotate-45 rounded-[3px] bg-primary" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">StewardAI</span>
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 lg:flex">
        <div className="px-4 py-5">
          <Wordmark />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-border p-3">
          <UserMenu email={email} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-border bg-card/40 px-4 py-3 lg:hidden">
        <Wordmark />
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-card">
            <div className="flex items-center justify-between px-4 py-5">
              <Wordmark />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3">
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-border p-3">
              <UserMenu email={email} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
