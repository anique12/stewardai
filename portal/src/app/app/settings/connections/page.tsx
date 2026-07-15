"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { AppCard, type CardStatus } from "@/components/integrations/AppCard";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { CATALOG, filterCatalog, type AppCategory, type CatalogApp } from "@/lib/integrations/catalog";
import { cn } from "@/lib/utils";

type StatusRow = { app: string; status: CardStatus; account_label: string | null; connected_at: string | null };

const CATEGORIES: (AppCategory | "All")[] = [
  "All", "Email", "Calendar", "Docs", "Storage", "Comms", "Project", "CRM", "Meetings",
];

export default function ConnectionsPage() {
  const queryClient = useQueryClient();
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AppCategory | "All">("All");

  const {
    data: apps,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["integrations-status"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const { apps } = (await res.json()) as { apps: StatusRow[] };
      return apps;
    },
    // This page also serves as the OAuth popup landing — refetch on
    // *every* window focus (not just when TanStack considers the data
    // stale) so the underlying tab/window reliably picks up a
    // just-completed connection even if the popup closes within the
    // provider's staleTime window.
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });

  const loaded = !isLoading;
  // Only surface a full error state when we have no cached data yet — a
  // focus-refresh failure with existing data just keeps last-known (React
  // Query retains the previous successful `data` across a failed refetch).
  const loadError = isError && apps === undefined;
  const statusBySlug = useMemo(
    () => new Map((apps ?? []).map((r) => [r.app, r])),
    [apps]
  );

  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: ["integrations-status"] });

  // If this page was opened as the OAuth popup (window.opener set) and Composio
  // redirected back with ?status=success, auto-close so the user returns to chat
  // — the chat's connect card polls status and resumes on its own.
  useEffect(() => {
    try {
      const ok = new URLSearchParams(window.location.search).get("status") === "success";
      if (ok && window.opener && window.opener !== window) {
        setTimeout(() => window.close(), 400);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function statusFor(app: CatalogApp): CardStatus {
    if (app.availability === "coming_soon") return "disconnected";
    if (!loaded) return "loading";
    return statusBySlug.get(app.slug)?.status ?? "disconnected";
  }

  async function handleConnect(app: CatalogApp) {
    setBusySlug(app.slug);
    try {
      const redirectUri = `${window.location.origin}/app/settings/connections`;
      const res = await fetch(`/api/integrations/${app.slug}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectUri }),
      });
      if (!res.ok) { setBusySlug(null); return; }
      const { redirectUrl } = (await res.json()) as { redirectUrl: string | null };
      if (redirectUrl) window.location.href = redirectUrl;
      else setBusySlug(null);
    } catch { setBusySlug(null); }
  }

  async function handleDisconnect(app: CatalogApp) {
    setBusySlug(app.slug);
    try {
      await fetch(`/api/integrations/${app.slug}/disconnect`, { method: "POST" });
      await refreshStatus();
    } finally { setBusySlug(null); }
  }

  const filtered = useMemo(() => filterCatalog(CATALOG, query, category), [query, category]);
  const connected = filtered.filter((a) => a.availability === "live" && ["connected", "pending", "error"].includes(statusFor(a)));
  const available = filtered.filter((a) => a.availability === "live" && !connected.includes(a));
  const comingSoon = filtered.filter((a) => a.availability === "coming_soon");
  const totalShown = connected.length + available.length + comingSoon.length;

  function renderCard(app: CatalogApp) {
    const row = statusBySlug.get(app.slug);
    return (
      <AppCard
        key={app.slug}
        app={app}
        status={statusFor(app)}
        accountLabel={row?.account_label ?? null}
        connectedAt={row?.connected_at ?? null}
        busy={busySlug === app.slug}
        onConnect={() => handleConnect(app)}
        onDisconnect={() => handleDisconnect(app)}
      />
    );
  }

  const Section = ({ title, dotClassName, apps }: { title: string; dotClassName: string; apps: CatalogApp[] }) =>
    apps.length ? (
      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-pill", dotClassName)} />
          <span className="text-[13px] font-bold text-ink">{title}</span>
          <span className="font-mono text-[10.5px] text-ink-3">{apps.length}</span>
        </div>
        <div className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{apps.map(renderCard)}</div>
      </section>
    ) : null;

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Connected apps" subtitle="What MeetBase can read from and act on — you control every connection" />
        <ErrorState title="Couldn't load integrations" onRetry={refreshStatus} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connected apps"
        subtitle="What MeetBase can read from and act on — you control every connection"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search integrations…"
            className="w-full rounded-md border border-line-2 bg-surface py-[9px] pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-pill px-2.5 py-1 text-xs font-semibold transition-colors",
                category === c
                  ? "bg-brand text-on-brand"
                  : "border border-line text-ink-3 hover:text-ink"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <div className="space-y-3">
          <Skeleton className="h-[26px] w-[180px]" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : totalShown === 0 ? (
        <EmptyState
          icon={
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path
                d="M10 4H6a2 2 0 00-2 2v4M14 4h4a2 2 0 012 2v4M10 20H6a2 2 0 01-2-2v-4M14 20h4a2 2 0 002-2v-4"
                stroke="var(--on-brand)"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          }
          title="No apps match your search"
          body="Try a different search term or category."
        />
      ) : (
        <div>
          <Section title="Connected" dotClassName="bg-brand" apps={connected} />
          <Section title="Available" dotClassName="bg-ink-4" apps={available} />
          <Section title="Coming soon" dotClassName="bg-line-strong" apps={comingSoon} />
        </div>
      )}
    </div>
  );
}
