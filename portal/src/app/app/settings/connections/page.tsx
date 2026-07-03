"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppCard, type CardStatus } from "@/components/integrations/AppCard";
import { CATALOG, filterCatalog, type AppCategory, type CatalogApp } from "@/lib/integrations/catalog";

type StatusRow = { app: string; status: CardStatus; account_label: string | null; connected_at: string | null };

const CATEGORIES: (AppCategory | "All")[] = [
  "All", "Email", "Calendar", "Docs", "Storage", "Comms", "Project", "CRM", "Meetings",
];

export default function ConnectionsPage() {
  const [statusBySlug, setStatusBySlug] = useState<Map<string, StatusRow>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AppCategory | "All">("All");

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) return;
      const { apps } = (await res.json()) as { apps: StatusRow[] };
      setStatusBySlug(new Map(apps.map((r) => [r.app, r])));
    } catch {
      // keep last-known
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, [refreshStatus]);

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

  const Section = ({ title, apps }: { title: string; apps: CatalogApp[] }) =>
    apps.length ? (
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{apps.map(renderCard)}</div>
      </section>
    ) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Connected Apps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect services so Steward can act on your behalf.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps…"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                category === c ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {connected.length + available.length + comingSoon.length === 0 ? (
        <p className="text-sm text-muted-foreground">No apps match your search.</p>
      ) : (
        <div className="space-y-8">
          <Section title="Connected" apps={connected} />
          <Section title="Available" apps={available} />
          <Section title="Coming soon" apps={comingSoon} />
        </div>
      )}
    </div>
  );
}
