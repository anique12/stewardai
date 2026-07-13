"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, MobileNavDrawer } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { routeTitleFor, type NavCounts } from "./nav";
import { CommandPalette } from "./CommandPalette";
import { NudgesPanel } from "./NudgesPanel";
import { InstantJoinDialog } from "./InstantJoinDialog";
import { Toast } from "./Toast";

/**
 * Client shell composing Sidebar + Topbar + mobile nav/drawer, and owning
 * open-state for the overlays (command palette, nudges panel, instant-join
 * dialog, toast host).
 */
export function AppChrome({
  email,
  counts,
  children,
}: {
  email: string;
  counts: NavCounts;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { title, subtitle } = routeTitleFor(pathname);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [nudgesOpen, setNudgesOpen] = useState(false);
  const [instantOpen, setInstantOpen] = useState(false);
  const [nudgeCount, setNudgeCount] = useState(0);

  // ⌘K / Ctrl+K opens the command palette from anywhere in the app shell.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <>
      <Sidebar email={email} counts={counts} />
      <MobileNavDrawer open={drawerOpen} onClose={closeDrawer} email={email} counts={counts} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar
          title={title}
          subtitle={subtitle}
          nudgeCount={nudgeCount}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenInstantJoin={() => setInstantOpen(true)}
          onOpenNudges={() => setNudgesOpen(true)}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </main>
        <MobileBottomNav counts={counts} />
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <NudgesPanel open={nudgesOpen} onOpenChange={setNudgesOpen} onCountChange={setNudgeCount} />
      <InstantJoinDialog open={instantOpen} onOpenChange={setInstantOpen} />
      <Toast />
    </>
  );
}
