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
import { useState } from "react";

export type AgentAction = {
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

export function ToolkitIcon({ toolkit }: { toolkit: string | null }) {
  const cls = "h-4 w-4";
  const wrap =
    "flex h-6 w-6 items-center justify-center rounded-full bg-white p-0.5 ring-1 ring-border";
  switch (toolkit?.toLowerCase()) {
    case "gmail":
      return (
        <span className={wrap}>
          <GmailIcon className={cls} />
        </span>
      );
    case "googlecalendar":
      return (
        <span className={wrap}>
          <GoogleCalendarIcon className={cls} />
        </span>
      );
    case "notion":
      return (
        <span className={wrap}>
          <NotionIcon className={cls} />
        </span>
      );
    case "slack":
      return (
        <span className={wrap}>
          <SlackIcon className={cls} />
        </span>
      );
    default:
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs">
          ?
        </span>
      );
  }
}

export function StateBadge({ state }: { state: AgentAction["state"] }) {
  switch (state) {
    case "proposed":
      return (
        <Badge className="border-attention-weak bg-attention-weak text-attention-strong hover:bg-attention-weak">
          Needs approval
        </Badge>
      );
    case "approved":
    case "running":
      return (
        <Badge className="border-brand-weak-2 bg-brand-weak text-brand-ink hover:bg-brand-weak">
          {state === "running" ? "Running…" : "Approved"}
        </Badge>
      );
    case "done":
      return (
        <Badge className="border-brand-weak-2 bg-surface text-brand hover:bg-surface">
          Done
        </Badge>
      );
    case "failed":
      return (
        <Badge className="border-danger-weak bg-danger-weak text-danger-strong hover:bg-danger-weak">
          Failed
        </Badge>
      );
  }
}

const TOOLKIT_LABEL: Record<string, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  notion: "Notion",
  slack: "Slack",
};

function toolkitLabel(t: string | null): string {
  if (!t) return "";
  return TOOLKIT_LABEL[t.toLowerCase()] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

function humanKey(k: string): string {
  return k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// A short, human-readable preview of an action's args — no raw JSON. Skips empty
// values and long blobs, capped so the card stays scannable.
function argPreview(args: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v == null || v === "") continue;
    let s =
      typeof v === "string"
        ? v
        : Array.isArray(v)
        ? v.join(", ")
        : typeof v === "object"
        ? ""
        : String(v);
    s = s.trim();
    if (!s) continue;
    if (s.length > 140) s = s.slice(0, 137) + "…";
    out.push([humanKey(k), s]);
    if (out.length >= 4) break;
  }
  return out;
}

export function ActionStepCard({
  action,
  meetingId,
  onMutate,
  variant = "full",
}: {
  action: AgentAction;
  meetingId: string;
  onMutate: () => void;
  variant?: "full" | "compact";
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

  // Compact: status-focused, no payload / no slug subtitle / no edit — used inline
  // under a timeline utterance. Title is smaller than the parent utterance text.
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2">
        <ToolkitIcon toolkit={toolkit} />
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          {action.title ?? slug ?? "Unnamed action"}
        </p>
        {action.state === "proposed" ? (
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={handleApprove}>
              Approve
            </Button>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy} onClick={handleDismiss}>
              Dismiss
            </Button>
          </div>
        ) : (
          <StateBadge state={action.state} />
        )}
      </div>
    );
  }

  const preview = argPreview(action.args);

  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <ToolkitIcon toolkit={toolkit} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {action.title ?? slug ?? "Unnamed action"}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            {toolkitLabel(toolkit)}
            {action.risk === "high" ? " · High risk" : ""}
          </p>
        </div>
        <StateBadge state={action.state} />
      </div>

      {/* Proposed: a human-readable preview of what will happen + controls */}
      {action.state === "proposed" && (
        <div className="space-y-2 pl-9">
          {editing ? (
            <div className="space-y-2">
              {Object.entries(editedArgs).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="w-24 shrink-0 text-xs text-ink-3">{humanKey(key)}</label>
                  <Input
                    className="h-7 text-xs"
                    value={String(val ?? "")}
                    onChange={(e) => setEditedArgs((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ) : (
            preview.length > 0 && (
              <dl className="space-y-1">
                {preview.map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs">
                    <dt className="w-24 shrink-0 text-ink-3">{k}</dt>
                    <dd className="min-w-0 flex-1 truncate text-ink-2">{v}</dd>
                  </div>
                ))}
              </dl>
            )
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={handleApprove}>Approve</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={handleDismiss}>Dismiss</Button>
            {Object.keys(action.args ?? {}).length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-ink-3"
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? "Cancel" : "Edit"}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Failed: human error only — never a raw payload */}
      {action.state === "failed" && action.error && action.error !== "dismissed by user" && (
        <p className="pl-9 text-xs text-danger-strong/80">{action.error}</p>
      )}
    </div>
  );
}
