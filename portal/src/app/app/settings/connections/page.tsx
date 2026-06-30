"use client";

import {
  GmailIcon,
  GoogleCalendarIcon,
  NotionIcon,
  SlackIcon,
} from "@/components/landing/integration-icons";
import { useCallback, useEffect, useState } from "react";

type AppStatus = "connected" | "pending" | "error" | "disconnected" | "loading";

interface AppConnection {
  id: string;
  name: string;
  slug: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  status: AppStatus;
}

const APP_DEFS: Omit<AppConnection, "status">[] = [
  {
    id: "gmail",
    slug: "gmail",
    name: "Gmail",
    description: "Read, send, and manage email on behalf of the user.",
    Icon: GmailIcon,
  },
  {
    id: "googlecalendar",
    slug: "googlecalendar",
    name: "Google Calendar",
    description: "Create and update calendar events and check availability.",
    Icon: GoogleCalendarIcon,
  },
  {
    id: "notion",
    slug: "notion",
    name: "Notion",
    description: "Search, read, and write Notion pages and databases.",
    Icon: NotionIcon,
  },
  {
    id: "slack",
    slug: "slack",
    name: "Slack",
    description: "Post messages and read channels in your workspace.",
    Icon: SlackIcon,
  },
];

function statusLabel(status: AppStatus) {
  switch (status) {
    case "connected":
      return "Connected";
    case "pending":
      return "Pending";
    case "error":
      return "Error";
    case "disconnected":
      return "Not connected";
    case "loading":
      return "Loading…";
  }
}

function StatusBadge({ status }: { status: AppStatus }) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  const colors: Record<AppStatus, string> = {
    connected: "bg-emerald-500/15 text-emerald-400",
    pending: "bg-yellow-500/15 text-yellow-400",
    error: "bg-red-500/15 text-red-400",
    disconnected: "bg-muted text-muted-foreground",
    loading: "bg-muted text-muted-foreground",
  };
  return <span className={`${base} ${colors[status]}`}>{statusLabel(status)}</span>;
}

export default function ConnectionsPage() {
  const [apps, setApps] = useState<AppConnection[]>(
    APP_DEFS.map((a) => ({ ...a, status: "loading" }))
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) return;
      const { apps: rows } = (await res.json()) as {
        apps: { app: string; status: AppStatus }[];
      };
      const bySlug = new Map(rows.map((r) => [r.app, r.status]));
      setApps((prev) =>
        prev.map((a) => ({
          ...a,
          status: bySlug.get(a.slug) ?? "disconnected",
        }))
      );
    } catch {
      // leave state as-is
    }
  }, []);

  // Refresh on mount and after returning from OAuth (focus event)
  useEffect(() => {
    refreshStatus();
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, [refreshStatus]);

  async function handleConnect(app: AppConnection) {
    setActionLoading(app.slug);
    try {
      const redirectUri = `${window.location.origin}/app/settings/connections`;
      const res = await fetch(`/api/integrations/${app.slug}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectUri }),
      });
      if (!res.ok) {
        console.error("Connect failed", await res.text());
        setActionLoading(null);
        return;
      }
      const { redirectUrl } = (await res.json()) as { redirectUrl: string | null };
      // Mark as pending optimistically
      setApps((prev) =>
        prev.map((a) => (a.slug === app.slug ? { ...a, status: "pending" } : a))
      );
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    } catch {
      setActionLoading(null);
    }
  }

  async function handleDisconnect(app: AppConnection) {
    setActionLoading(app.slug);
    try {
      await fetch(`/api/integrations/${app.slug}/disconnect`, {
        method: "POST",
      });
      setApps((prev) =>
        prev.map((a) =>
          a.slug === app.slug ? { ...a, status: "disconnected" } : a
        )
      );
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Connected Apps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect third-party services so your AI assistant can act on your
          behalf.
        </p>
      </div>

      <div className="space-y-4">
        {apps.map((app) => {
          const isLoading = actionLoading === app.slug;
          const isConnected = app.status === "connected";
          const isPending = app.status === "pending";

          return (
            <div
              key={app.slug}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
            >
              {/* Icon tile */}
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white p-1.5">
                <app.Icon className="h-9 w-9" />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{app.name}</span>
                  <StatusBadge status={app.status} />
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {app.description}
                </p>
              </div>

              {/* Action */}
              <div className="shrink-0">
                {isConnected ? (
                  <button
                    onClick={() => handleDisconnect(app)}
                    disabled={isLoading}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? "Disconnecting…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(app)}
                    disabled={isLoading || isPending}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? "Connecting…" : isPending ? "Pending…" : "Connect"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
