"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, MobileNavDrawer } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { routeTitleFor, type NavCounts } from "./nav";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Client shell composing Sidebar + Topbar + mobile nav/drawer, and owning
 * open-state for the overlays Task 4 will build out (command palette,
 * nudges panel, instant-join dialog). Each overlay below is a minimal
 * placeholder — Task 4 replaces the `{/* Task 4: ... *\/}` body only; the
 * open-state wiring here (and the Topbar/MobileBottomNav triggers) stays.
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
          nudgeCount={0}
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

      {/* Task 4: replace with the real command palette (⌘K search). */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Search</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-3">…</p>
        </DialogContent>
      </Dialog>

      {/* Task 4: replace with the real nudges panel. */}
      <Dialog open={nudgesOpen} onOpenChange={setNudgesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nudges</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-3">…</p>
        </DialogContent>
      </Dialog>

      {/* Task 4: replace with the real instant-join dialog. */}
      <Dialog open={instantOpen} onOpenChange={setInstantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instant join</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-3">…</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
