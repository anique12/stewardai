"use client";
import {
  GmailIcon, GoogleCalendarIcon, NotionIcon, SlackIcon,
} from "@/components/landing/integration-icons";
import type { CatalogApp } from "@/lib/integrations/catalog";

export type CardStatus = "connected" | "pending" | "error" | "disconnected" | "loading";

export function AppIcon({ slug, name, muted }: { slug: string; name: string; muted?: boolean }) {
  const cls = "h-5 w-5";
  const known: Record<string, React.ComponentType<{ className?: string }>> = {
    gmail: GmailIcon, googlecalendar: GoogleCalendarIcon, notion: NotionIcon, slack: SlackIcon,
  };
  const Brand = known[slug];
  if (Brand) {
    return (
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white p-2 ${muted ? "opacity-70 grayscale" : ""}`}
      >
        <Brand className={cls} />
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 font-display text-base font-bold text-ink-3">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const STATUS_BADGE: Record<CardStatus, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "text-brand bg-brand-weak border-brand-weak-2" },
  pending: { label: "Pending", cls: "text-attention-strong bg-attention-weak border-attention-weak" },
  error: { label: "Needs reconnect", cls: "text-danger-strong bg-danger-weak border-danger-weak" },
  disconnected: { label: "Not connected", cls: "text-ink-3 bg-surface-2 border-line" },
  loading: { label: "…", cls: "text-ink-4 bg-surface-2 border-line" },
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
  const badge = STATUS_BADGE[status];

  const accountText = isConnected
    ? [accountLabel, connectedAt ? `since ${new Date(connectedAt).toLocaleDateString()}` : null]
        .filter(Boolean)
        .join(" · ")
    : null;

  if (comingSoon) {
    return (
      <div
        title={app.description}
        className="flex items-center gap-3 rounded-lg border border-dashed border-line-2 bg-surface p-4 opacity-90"
      >
        <AppIcon slug={app.slug} name={app.name} muted />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-ink-2">{app.name}</div>
          <div className="truncate text-[11px] text-ink-4">{app.category}</div>
        </div>
        <button
          type="button"
          disabled
          title="Available soon"
          className="shrink-0 cursor-not-allowed rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-3 opacity-70"
        >
          Notify me
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sh-1">
      <div className="flex items-center gap-3">
        <AppIcon slug={app.slug} name={app.name} />
        <div className="min-w-0 flex-1" title={app.description}>
          <div className="truncate text-sm font-bold text-ink">{app.name}</div>
          <div className="truncate text-[11.5px] text-ink-3">{app.category}</div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-[5px] rounded-pill border px-2 py-[3px] font-mono text-[9.5px] font-semibold ${badge.cls}`}
        >
          <span className="h-[5px] w-[5px] shrink-0 rounded-pill bg-current" />
          {badge.label}
        </span>
      </div>

      {isConnected ? (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">
            {accountText || "Connected"}
          </span>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="shrink-0 rounded-md border border-line bg-surface-2 px-[11px] py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:border-danger hover:text-danger-strong disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={busy || status === "pending" || status === "loading"}
          className="mt-3 w-full rounded-md bg-brand px-3 py-2 text-[12.5px] font-semibold text-on-brand transition-colors hover:bg-brand-2 disabled:opacity-50"
        >
          {busy ? "Connecting…" : status === "pending" ? "Pending…" : isError ? "Reconnect" : "Connect"}
        </button>
      )}
    </div>
  );
}
