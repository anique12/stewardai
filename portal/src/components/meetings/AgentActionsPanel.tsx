"use client";

import {
  GmailIcon,
  GoogleCalendarIcon,
  NotionIcon,
  SlackIcon,
} from "@/components/landing/integration-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useState } from "react";

type AgentAction = {
  id: string;
  meeting_id: string;
  toolkit: string | null;
  action_slug: string | null;
  title: string | null;
  state: "proposed" | "approved" | "running" | "done" | "failed";
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  risk: "low" | "high" | null;
  source: "directed" | "inferred" | null;
};

function ToolkitIcon({ toolkit }: { toolkit: string | null }) {
  const cls = "h-5 w-5";
  switch (toolkit?.toLowerCase()) {
    case "gmail":
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-white p-0.5">
          <GmailIcon className={cls} />
        </span>
      );
    case "googlecalendar":
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-white p-0.5">
          <GoogleCalendarIcon className={cls} />
        </span>
      );
    case "notion":
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-white p-0.5">
          <NotionIcon className={cls} />
        </span>
      );
    case "slack":
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-white p-0.5">
          <SlackIcon className={cls} />
        </span>
      );
    default:
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-muted text-muted-foreground text-xs">
          ?
        </span>
      );
  }
}

function StateBadge({ state }: { state: AgentAction["state"] }) {
  switch (state) {
    case "proposed":
      return (
        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/20">
          Needs approval
        </Badge>
      );
    case "approved":
    case "running":
      return (
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/20">
          {state === "running" ? "Running…" : "Approved"}
        </Badge>
      );
    case "done":
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/20">
          Done
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/20">
          Failed
        </Badge>
      );
  }
}

function ActionRow({
  action,
  meetingId,
  onMutate,
}: {
  action: AgentAction;
  meetingId: string;
  onMutate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState<Record<string, unknown>>(action.args ?? {});
  const [busy, setBusy] = useState(false);

  async function handleApprove() {
    setBusy(true);
    await fetch(
      `/api/meetings/${meetingId}/actions/${action.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: editedArgs }),
      }
    );
    setBusy(false);
    setEditing(false);
    onMutate();
  }

  async function handleDismiss() {
    setBusy(true);
    await fetch(
      `/api/meetings/${meetingId}/actions/${action.id}/dismiss`,
      { method: "POST" }
    );
    setBusy(false);
    onMutate();
  }

  const toolkit = action.toolkit ?? "";
  const slug = action.action_slug ?? "";

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <ToolkitIcon toolkit={toolkit} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-foreground truncate">
              {action.title ?? slug ?? "Unnamed action"}
            </p>
            {action.risk === "high" && (
              <Badge variant="destructive" className="text-xs">High risk</Badge>
            )}
          </div>
          {(toolkit || slug) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {[toolkit, slug].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <StateBadge state={action.state} />
      </div>

      {/* Edit affordance for proposed rows */}
      {action.state === "proposed" && editing && (
        <div className="space-y-2 pl-10">
          {Object.entries(editedArgs).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-24 shrink-0">{key}</label>
              <Input
                className="h-7 text-xs"
                value={String(val ?? "")}
                onChange={(e) =>
                  setEditedArgs((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      )}

      {/* Controls for proposed rows */}
      {action.state === "proposed" && (
        <div className="flex items-center gap-2 pl-10">
          <Button
            size="sm"
            variant="default"
            disabled={busy}
            onClick={handleApprove}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={handleDismiss}
          >
            Dismiss
          </Button>
          {Object.keys(action.args ?? {}).length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Cancel edit" : "Edit"}
            </Button>
          )}
        </div>
      )}

      {/* Done: show result summary */}
      {action.state === "done" && action.result && (
        <p className="pl-10 text-xs text-green-400/80">
          {typeof action.result === "object"
            ? JSON.stringify(action.result).slice(0, 120)
            : String(action.result)}
        </p>
      )}

      {/* Failed: show error (but not when it's just a dismissal) */}
      {action.state === "failed" && action.error && action.error !== "dismissed by user" && (
        <p className="pl-10 text-xs text-red-400/80">{action.error}</p>
      )}
    </div>
  );
}

const STATE_ORDER: Record<AgentAction["state"], number> = {
  proposed: 0,
  approved: 1,
  running: 2,
  done: 3,
  failed: 4,
};

export function AgentActionsPanel({
  actions: initial,
  meetingId,
}: {
  actions: AgentAction[];
  meetingId: string;
}) {
  const router = useRouter();
  function refresh() {
    router.refresh();
  }

  const sorted = [...initial].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]
  );

  if (!sorted.length) {
    return (
      <p className="text-muted-foreground">
        No actions proposed yet. Steward will suggest actions after the meeting.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((action) => (
        <ActionRow
          key={action.id}
          action={action}
          meetingId={meetingId}
          onMutate={refresh}
        />
      ))}
    </div>
  );
}
