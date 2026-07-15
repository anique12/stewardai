"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { WORKSPACE_NAV, ACCOUNT_NAV, type NavCounts, type NavItem } from "./nav";
import { useSettingsModal } from "./SettingsModalContext";
import { cn } from "@/lib/utils";

function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/app" className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- small local brand mark */}
      <img src="/meetbase-mark.png" alt="MeetBase" className={cn("shrink-0", compact ? "h-7 w-7" : "h-[30px] w-[30px]")} />
      <span className="leading-tight">
        <span className="block font-display text-[16px] font-bold tracking-tight text-ink">
          Meet<span className="text-brand">Base</span>
        </span>
        {!compact ? (
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">Meeting agent</span>
        ) : null}
      </span>
    </Link>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  counts,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  counts: NavCounts;
  onNavigate?: () => void;
}) {
  const { openSettings, settingsOpen } = useSettingsModal();

  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-[11px] pb-[5px] pt-2 font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">{label}</div>
      {items.map((item) => {
        const active = item.action === "settings" ? settingsOpen : item.isActive(pathname);
        const count = item.countKey ? counts[item.countKey] : undefined;
        const className = cn(
          "flex items-center gap-[9px] rounded-md px-[11px] py-2 text-[13.5px] font-medium transition-colors",
          active ? "bg-brand-weak text-brand-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
        );
        const content = (
          <>
            <item.icon className="h-[17px] w-[17px] shrink-0" aria-hidden />
            <span className="flex-1 text-left">{item.label}</span>
            {item.liveKey && counts[item.liveKey] ? (
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-pill bg-brand anim-pulse"
                aria-label="Meeting in progress"
              />
            ) : null}
            {count ? (
              <span className="min-w-[19px] rounded-pill bg-attention-weak px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-attention-strong">
                {count}
              </span>
            ) : null}
          </>
        );

        if (item.action === "settings") {
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                openSettings();
                onNavigate?.();
              }}
              aria-current={active ? "page" : undefined}
              className={className}
            >
              {content}
            </button>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href ?? "#"}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={className}
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar({ email, avatarUrl, counts }: { email: string; avatarUrl?: string | null; counts: NavCounts }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[252px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="px-[18px] pb-3.5 pt-[18px]">
        <Wordmark />
      </div>

      <div className="px-3 pb-0.5 pt-1">
        <Link
          href="/app/chat"
          className="flex w-full items-center justify-center gap-[9px] rounded-md bg-brand px-[11px] py-2.5 text-[13.5px] font-semibold text-on-brand shadow-sh-1 transition-colors hover:bg-brand-2"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          Ask MeetBase
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pt-2.5">
        <NavGroup label="Workspace" items={WORKSPACE_NAV} pathname={pathname} counts={counts} />
        <NavGroup label="Account" items={ACCOUNT_NAV} pathname={pathname} counts={counts} />
      </nav>

      <div className="border-t border-line p-[10px]">
        <UserMenu email={email} avatarUrl={avatarUrl} />
      </div>
    </aside>
  );
}

/** Restyled mobile drawer — state (`open`) is owned by AppChrome. */
export function MobileNavDrawer({
  open,
  onClose,
  email,
  avatarUrl,
  counts,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  avatarUrl?: string | null;
  counts: NavCounts;
}) {
  const pathname = usePathname();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/40 anim-fadeup" onClick={onClose} aria-hidden />
      <div className="absolute inset-y-0 left-0 flex w-[270px] flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface p-4 anim-fadeup">
        <div className="flex items-center justify-between gap-2 pb-3.5">
          <Wordmark compact />
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-surface-2"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>

        <NavGroup label="Workspace" items={WORKSPACE_NAV} pathname={pathname} counts={counts} onNavigate={onClose} />
        <NavGroup label="Account" items={ACCOUNT_NAV} pathname={pathname} counts={counts} onNavigate={onClose} />

        <div className="flex-1" />
        <div className="border-t border-line pt-3">
          <UserMenu email={email} avatarUrl={avatarUrl} />
        </div>
      </div>
    </div>
  );
}
