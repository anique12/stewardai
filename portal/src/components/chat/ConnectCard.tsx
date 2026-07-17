"use client";

// Shown inline in the assistant's turn when the server pauses the run on a
// `connect_required` event (MeetBase needs a Composio connection to continue).
//
// The connect flow: POST /api/integrations/{app}/connect to get the Composio
// OAuth URL, open it in a POPUP (so the chat WebSocket stays open and the paused
// turn survives — a full-page redirect would drop both), then poll
// /api/integrations/status until the app is connected and only THEN resume the
// turn via onConnect() (connect_done → retry). This mirrors the proven Connected
// Apps settings flow, minus the full-page navigation.

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plug, ShieldCheck } from "lucide-react";
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
  // Flipped by the popup's completion signal (BroadcastChannel/storage) so the
  // poll wakes immediately instead of waiting out its next 2.5s tick.
  const signalled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Listen for the /oauth/complete popup's "connection finished" signal.
  useEffect(() => {
    const onSignal = (a?: unknown) => {
      if (!a || a === app) signalled.current = true;
    };
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("composio-oauth");
      bc.onmessage = (e) => onSignal((e.data as { app?: string })?.app);
    } catch {
      // ignore — storage fallback below
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === "composio-oauth") onSignal();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      try {
        bc?.close();
      } catch {
        /* ignore */
      }
      window.removeEventListener("storage", onStorage);
    };
  }, [app]);

  async function isConnected(): Promise<boolean> {
    try {
      // no-store: this is polled repeatedly against the same URL — a cached
      // response would report the pre-connection state forever.
      const res = await fetch("/api/integrations/status", { cache: "no-store" });
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

  // Poll until the app reports connected (or we time out ~2.5 min). Between
  // checks we sleep in short slices so the popup's completion signal wakes us
  // within ~100ms instead of at the next 2.5s tick.
  async function pollUntilConnected(): Promise<boolean> {
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && !cancelled.current) {
      for (let i = 0; i < 25 && !signalled.current && !cancelled.current; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      signalled.current = false;
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
      // Land the popup on a minimal page that closes itself + signals us,
      // rather than the full app (which would just sit open showing MeetBase).
      const redirectUri = `${window.location.origin}/oauth/complete?app=${encodeURIComponent(app)}`;
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

  if (phase === "connected") {
    return (
      <div className="flex items-center gap-[11px] rounded-xl border border-brand-weak-2 bg-brand-weak px-4 py-3">
        <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-brand-ink">{label} connected</div>
          <div className="text-[11.5px] text-ink-3">Picking up where we left off…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line-2 bg-surface p-4 shadow-sh-1">
      <div className="flex items-center gap-3">
        <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-ink-2">
          <Plug className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold text-ink">Connect {label}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-ink-2">
            {phase === "connecting"
              ? `A window opened to connect ${label}. Approve access there — I'll continue automatically once it's linked.`
              : `MeetBase needs access to ${label} to keep going. Connect it and I'll continue.`}
          </div>
          {error && <p className="mt-1 text-xs text-attention-strong">{error}</p>}
        </div>
      </div>

      {phase === "connecting" ? (
        <div className="mt-3.5 flex items-center gap-2 text-sm text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
          Waiting for {label}…
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <Button
            size="sm"
            onClick={handleConnect}
            className="rounded-lg bg-brand text-on-brand shadow-sh-1 hover:bg-brand-2"
          >
            {phase === "error" ? "Try again" : `Connect ${label}`}
          </Button>
          {phase === "error" && (
            <Button size="sm" variant="outline" onClick={onConnect}>
              Continue
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Skip
          </Button>
          <span className="ml-auto inline-flex items-center gap-[5px] text-[11px] text-ink-3">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            OAuth · revoke anytime
          </span>
        </div>
      )}
    </div>
  );
}
