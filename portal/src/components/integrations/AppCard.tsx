"use client";
import {
  GmailIcon, GoogleCalendarIcon, NotionIcon, SlackIcon,
} from "@/components/landing/integration-icons";
import type { CatalogApp } from "@/lib/integrations/catalog";

export type CardStatus = "connected" | "pending" | "error" | "disconnected" | "loading";

export function AppIcon({ slug, name }: { slug: string; name: string }) {
  const cls = "h-6 w-6";
  const known: Record<string, React.ComponentType<{ className?: string }>> = {
    gmail: GmailIcon, googlecalendar: GoogleCalendarIcon, notion: NotionIcon, slack: SlackIcon,
  };
  const Brand = known[slug];
  if (Brand) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1.5">
        <Brand className={cls} />
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const STATUS_BADGE: Record<CardStatus, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-emerald-500/15 text-emerald-400" },
  pending: { label: "Pending", cls: "bg-yellow-500/15 text-yellow-400" },
  error: { label: "Needs reconnect", cls: "bg-red-500/15 text-red-400" },
  disconnected: { label: "Not connected", cls: "bg-muted text-muted-foreground" },
  loading: { label: "…", cls: "bg-muted text-muted-foreground" },
};

export function AppCard({
  app, status, accountLabel, connectedAt, busy, onConnect, onDisconnect,
}: {
  app: CatalogApp; status: CardStatus; accountLabel: string | null; connectedAt: string | null;
  busy: boolean; onConnect: () => void; onDisconnect: () => void;
}) {
  const comingSoon = app.availability === "coming_soon";
  const isConnected = status === "connected";
  const isError = status === "error";
  const badge = comingSoon ? { label: "Coming soon", cls: "bg-muted text-muted-foreground" } : STATUS_BADGE[status];

  const meta = isConnected
    ? [accountLabel, connectedAt ? `since ${new Date(connectedAt).toLocaleDateString()}` : null].filter(Boolean).join(" · ")
    : null;

  return (
    <div className={`flex flex-col gap-3 rounded-lg border border-border bg-card p-4 ${comingSoon ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={comingSoon ? "grayscale" : ""}><AppIcon slug={app.slug} name={app.name} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{app.name}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{app.description}</p>
          {meta ? <p className="mt-1 text-xs text-muted-foreground">{meta}</p> : null}
        </div>
      </div>

      <div className="mt-auto">
        {comingSoon ? (
          <button
            type="button"
            disabled
            title="Available soon"
            className="w-full cursor-not-allowed rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-70"
          >
            Coming soon
          </button>
        ) : isConnected ? (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={busy || status === "pending" || status === "loading"}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Connecting…" : status === "pending" ? "Pending…" : isError ? "Reconnect" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}
