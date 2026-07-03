"use client";

// A prominent approval card shown inline in the assistant's turn when the
// server pauses the run on a `permission_request` event. Dark-theme teal
// accent (mirrors the primary/teal tokens used elsewhere in ChatMessages).

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

const HIDDEN_KEYS = new Set(["call_id", "kind", "tool", "type"]);

function humanKey(k: string): string {
  return k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function GenericPreview({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(([k, v]) => !HIDDEN_KEYS.has(k) && v != null && v !== "");

  if (entries.length === 0) return null;

  return (
    <dl className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-sm">
          <dt className="w-24 shrink-0 text-muted-foreground">{humanKey(k)}</dt>
          <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SendEmailPreview({ payload }: { payload: Record<string, unknown> }) {
  return (
    <dl className="space-y-1.5">
      <div className="flex gap-2 text-sm">
        <dt className="w-16 shrink-0 text-muted-foreground">To</dt>
        <dd className="min-w-0 flex-1 break-words text-foreground/90">{formatValue(payload.to)}</dd>
      </div>
      <div className="flex gap-2 text-sm">
        <dt className="w-16 shrink-0 text-muted-foreground">Subject</dt>
        <dd className="min-w-0 flex-1 break-words text-foreground/90">{formatValue(payload.subject)}</dd>
      </div>
      <div className="flex gap-2 text-sm">
        <dt className="w-16 shrink-0 text-muted-foreground">Body</dt>
        <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">
          {formatValue(payload.body)}
        </dd>
      </div>
    </dl>
  );
}

export function PermissionCard({
  permission,
  onDecide,
}: {
  permission: Record<string, unknown>;
  onDecide: (decision: "approve" | "reject" | "always") => void;
}) {
  const tool = typeof permission.tool === "string" ? permission.tool : "unknown tool";

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <ShieldAlert className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <p className="text-sm font-semibold text-foreground">Approve before running</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{tool}</p>
          </div>

          {tool === "send_email" ? (
            <SendEmailPreview payload={permission} />
          ) : (
            <GenericPreview payload={permission} />
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={() => onDecide("approve")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDecide("reject")}>
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => onDecide("always")}
            >
              Always allow
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
