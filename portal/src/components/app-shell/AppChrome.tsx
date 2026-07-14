"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sidebar, MobileNavDrawer } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { routeTitleFor, type NavCounts } from "./nav";
import { CommandPalette } from "./CommandPalette";
import { NudgesPanel } from "./NudgesPanel";
import { InstantJoinDialog } from "./InstantJoinDialog";
import { Toast } from "./Toast";
import { SettingsModalContext } from "./SettingsModalContext";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { CurrentUserProvider } from "@/components/common/CurrentUserContext";

/**
 * Client shell composing Sidebar + Topbar + mobile nav/drawer, and owning
 * open-state for the overlays (command palette, nudges panel, instant-join
 * dialog, toast host).
 */
export function AppChrome({
  email,
  avatarUrl,
  counts,
  children,
}: {
  email: string;
  avatarUrl?: string | null;
  counts: NavCounts;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { title, subtitle } = routeTitleFor(pathname);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [nudgesOpen, setNudgesOpen] = useState(false);
  const [instantOpen, setInstantOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // Deep-link support: `/app/settings` redirects to `/app?settings=1` — open
  // the modal once on arrival, then strip the param so the URL stays clean.
  useEffect(() => {
    if (searchParams.get("settings") === "1") {
      setSettingsOpen(true);
      router.replace(pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  return (
    <CurrentUserProvider value={{ email, avatarUrl: avatarUrl ?? null }}>
    <SettingsModalContext.Provider value={{ openSettings, settingsOpen }}>
      <Sidebar email={email} avatarUrl={avatarUrl} counts={counts} />
      <MobileNavDrawer open={drawerOpen} onClose={closeDrawer} email={email} avatarUrl={avatarUrl} counts={counts} />

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
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Toast />
    </SettingsModalContext.Provider>
    </CurrentUserProvider>
  );
}
