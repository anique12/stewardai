"use client";

// The approval card shown inline when the server pauses on a `permission_request`.
// Matches the artifact: a clean, EDITABLE draft (no raw tool name / App / Action /
// JSON args). For email actions it renders To / Subject / Body fields; for other
// tools it renders one editable field per argument. Approving sends the (possibly
// edited) args back so the user can fill things in here instead of over chat.

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type Decision = "approve" | "reject" | "always";

// Keys that are the permission envelope, not user-facing arguments.
const ENVELOPE_KEYS = new Set(["call_id", "kind", "tool", "type", "app", "action", "args"]);

function humanKey(k: string): string {
  return k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

// The tool arguments live under `args`; older/simple payloads may inline them.
function extractArgs(permission: Record<string, unknown>): Record<string, unknown> {
  const inner = permission.args;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(permission)) {
    if (!ENVELOPE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

function isEmailAction(tool: string, app: string): boolean {
  return /EMAIL|SEND_EMAIL|DRAFT/i.test(tool) || app.toLowerCase() === "gmail";
}

// Which arg key holds the recipient / subject / body across slight schema variants.
function pick(args: Record<string, unknown>, candidates: string[]): string {
  for (const c of candidates) {
    if (args[c] != null && args[c] !== "") return c;
  }
  return candidates[0];
}

const inputCls =
  "w-full rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-sm text-foreground " +
  "outline-none transition-colors focus:border-primary/60";

export function PermissionCard({
  permission,
  onDecide,
}: {
  permission: Record<string, unknown>;
  onDecide: (decision: Decision, args?: Record<string, unknown>) => void;
}) {
  const tool = typeof permission.tool === "string" ? permission.tool : "";
  const app = typeof permission.app === "string" ? permission.app : "";
  const initialArgs = extractArgs(permission);
  const email = isEmailAction(tool, app);

  // Editable copy of the args, keyed the same way so we can send them back.
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(initialArgs)) f[k] = asString(v);
    return f;
  });
  const set = (k: string, v: string) => setFields((s) => ({ ...s, [k]: v }));

  const toKey = pick(initialArgs, ["recipient_email", "to", "recipient", "email"]);
  const subjectKey = pick(initialArgs, ["subject"]);
  const bodyKey = pick(initialArgs, ["body", "message", "text"]);
  const otherKeys = Object.keys(initialArgs).filter(
    (k) => !email || (k !== toKey && k !== subjectKey && k !== bodyKey),
  );

  function approve() {
    // Send edited args back (merged over originals so untouched fields persist).
    onDecide("approve", { ...initialArgs, ...fields });
  }

  const title = email ? "Review & send email" : "Approve before running";
  const subtitle = email
    ? "Steward drafted this — edit anything, then send."
    : "This runs on your behalf. Review the details, then approve.";

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <ShieldCheck className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>

          {email ? (
            <div className="space-y-2.5">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">To</span>
                <input
                  className={inputCls}
                  value={fields[toKey] ?? ""}
                  onChange={(e) => set(toKey, e.target.value)}
                  placeholder="name@example.com"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Subject</span>
                <input
                  className={inputCls}
                  value={fields[subjectKey] ?? ""}
                  onChange={(e) => set(subjectKey, e.target.value)}
                  placeholder="Subject"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Body</span>
                <textarea
                  className={`${inputCls} min-h-[110px] resize-y leading-relaxed`}
                  value={fields[bodyKey] ?? ""}
                  onChange={(e) => set(bodyKey, e.target.value)}
                  placeholder="Write your message…"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-2.5">
              {otherKeys.length === 0 && (
                <p className="text-sm text-muted-foreground">No inputs — just confirm.</p>
              )}
              {otherKeys.map((k) => (
                <label key={k} className="block space-y-1">
                  <span className="text-xs text-muted-foreground">{humanKey(k)}</span>
                  {(fields[k] ?? "").length > 60 ? (
                    <textarea
                      className={`${inputCls} min-h-[80px] resize-y`}
                      value={fields[k] ?? ""}
                      onChange={(e) => set(k, e.target.value)}
                    />
                  ) : (
                    <input
                      className={inputCls}
                      value={fields[k] ?? ""}
                      onChange={(e) => set(k, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button size="sm" onClick={approve}>
              {email ? "Send" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDecide("reject")}>
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => onDecide("always", { ...initialArgs, ...fields })}
            >
              Always allow
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
