"use client";

// Shown inline in the assistant's turn when the server pauses the run on a
// `connect_required` event (Steward needs a Composio connection to continue).
// Amber, matching the amber "chat isn't configured"/pending-connect banners
// already used elsewhere in the chat surface.

import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConnectCard({
  connect,
  onConnect,
  onSkip,
}: {
  connect: Record<string, unknown>;
  onConnect: () => void;
  onSkip: () => void;
}) {
  const app = typeof connect.app === "string" && connect.app ? connect.app : "an app";
  const url = typeof connect.url === "string" ? connect.url : null;

  function handleConnect() {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    onConnect();
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-500">
          <Plug className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <p className="text-sm font-semibold text-foreground">Connect {app}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Steward needs access to {app} to keep going. Connect it, then come back here.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              className="bg-amber-500 text-amber-950 hover:bg-amber-500/90"
              onClick={handleConnect}
            >
              Connect
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onSkip}>
              Skip
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
