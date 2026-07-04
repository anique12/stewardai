"use client";

// Shown inline in the assistant's turn when the server pauses the run on a
// `connect_required` event (Steward needs a Composio connection to continue).
//
// The connect flow: POST /api/integrations/{app}/connect to get the Composio
// OAuth URL, open it in a POPUP (so the chat WebSocket stays open and the paused
// turn survives — a full-page redirect would drop both), then poll
// /api/integrations/status until the app is connected and only THEN resume the
// turn via onConnect() (connect_done → retry). This mirrors the proven Connected
// Apps settings flow, minus the full-page navigation.

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "connecting" | "connected" | "error";

export function ConnectCard({
  connect,
  onConnect,
  onSkip,
}: {
  connect: Record<string, unknown>;
  onConnect: () => void;
  onSkip: () => void;
}) {
  const app = typeof connect.app === "string" && connect.app ? connect.app : "";
  const label = app || "the app";
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function isConnected(): Promise<boolean> {
    try {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) return false;
      const data = await res.json();
      const row = (data?.apps ?? []).find(
        (a: { app?: string; status?: string }) => a.app === app,
      );
      return row?.status === "connected";
    } catch {
      return false;
    }
  }

  // Poll until the app reports connected (or we time out ~2.5 min).
  async function pollUntilConnected(): Promise<boolean> {
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && !cancelled.current) {
      await new Promise((r) => setTimeout(r, 2500));
      if (cancelled.current) return false;
      if (await isConnected()) return true;
    }
    return false;
  }

  async function handleConnect() {
    if (!app) {
      onConnect();
      return;
    }
    setPhase("connecting");
    setError(null);
    try {
      const redirectUri = `${window.location.origin}/app/settings/connections`;
      const res = await fetch(`/api/integrations/${app}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectUri }),
      });
      if (!res.ok) throw new Error("connect request failed");
      const { redirectUrl } = (await res.json()) as { redirectUrl: string | null };
      if (!redirectUrl) throw new Error("no redirect url");
      window.open(redirectUrl, "_blank", "noopener,noreferrer,width=620,height=820");

      const ok = await pollUntilConnected();
      if (cancelled.current) return;
      if (ok) {
        setPhase("connected");
        onConnect(); // resume the paused turn now that the app is connected
      } else {
        setPhase("error");
        setError("Didn't detect the connection yet. Finish in the popup, then click Continue.");
      }
    } catch {
      if (cancelled.current) return;
      setPhase("error");
      setError("Couldn't start the connection. Please try again.");
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-500">
          {phase === "connected" ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <Plug className="h-4 w-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <p className="text-sm font-semibold text-foreground">Connect {label}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {phase === "connecting"
                ? `A window opened to connect ${label}. Approve access there — I'll continue automatically once it's linked.`
                : phase === "connected"
                  ? `${label} connected — picking up where we left off…`
                  : `Steward needs access to ${label} to keep going. Connect it and I'll continue.`}
            </p>
            {error && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
          </div>

          {phase === "connected" ? null : phase === "connecting" ? (
            <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Waiting for {label}…
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onSkip}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                className="bg-amber-500 text-amber-950 hover:bg-amber-500/90"
                onClick={handleConnect}
              >
                {phase === "error" ? "Try again" : "Connect"}
              </Button>
              {phase === "error" && (
                <Button size="sm" variant="outline" onClick={onConnect}>
                  Continue
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onSkip}>
                Skip
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
