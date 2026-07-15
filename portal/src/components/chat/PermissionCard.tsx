"use client";

// The approval card shown inline when the server pauses on a `permission_request`.
// Matches the artifact: a clean, EDITABLE draft (no raw tool name / App / Action /
// JSON args). For email actions it renders To / Subject / Body fields; for other
// tools it renders one editable field per argument. Approving sends the (possibly
// edited) args back so the user can fill things in here instead of over chat.
//
// After a decision, the card swaps to a small receipt so the user gets confirmation
// without waiting on the round trip to the server. This is local UI state only (no
// new WS event) — and deliberately has no Undo action: undoing a sent email isn't
// something MeetBase supports, so we don't offer a button that can't do anything.

import { useState } from "react";
import { Check, Mail, ShieldCheck, X } from "lucide-react";
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
  "w-full rounded-md border border-line-2 bg-paper px-2.5 py-1.5 text-[13px] text-ink " +
  "outline-none transition-colors focus:border-brand-weak-2";

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

  // Local receipt state — swaps the pending form for a small confirmation once
  // the user decides, instead of waiting for the server's next event.
  const [decided, setDecided] = useState<null | "approved" | "rejected">(null);

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
    setDecided("approved");
    // Send edited args back (merged over originals so untouched fields persist).
    onDecide("approve", { ...initialArgs, ...fields });
  }

  function reject() {
    setDecided("rejected");
    onDecide("reject");
  }

  function always() {
    setDecided("approved");
    onDecide("always", { ...initialArgs, ...fields });
  }

  if (decided === "approved") {
    return (
      <div className="flex items-center gap-[11px] rounded-xl border border-brand-weak-2 bg-brand-weak p-3.5 shadow-sh-1">
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md bg-brand text-on-brand">
          <Check className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-brand-ink">
            {email ? `Email sent via ${app || "Gmail"}` : "Done"}
          </div>
          <div className="text-[11.5px] text-ink-3">
            {email && fields[toKey] ? `To ${fields[toKey]} · just now` : "Approved · just now"}
          </div>
        </div>
      </div>
    );
  }

  if (decided === "rejected") {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-line-2 px-3.5 py-3 text-[12.5px] text-ink-3">
        <X className="h-[15px] w-[15px] shrink-0" aria-hidden />
        You discarded this draft. MeetBase didn&apos;t send anything.
      </div>
    );
  }

  const title = email ? "Review & send email" : "Approve before running";
  const subtitle = email
    ? "MeetBase drafted this — edit anything, then send."
    : "This runs on your behalf. Review the details, then approve.";

  return (
    <div className="overflow-hidden rounded-xl border-[1.5px] border-attention shadow-sh-2">
      <div className="flex items-center gap-[9px] border-b border-attention bg-attention-weak px-4 py-3">
        <ShieldCheck className="h-[17px] w-[17px] shrink-0 text-attention-strong" aria-hidden />
        <span className="flex-1 text-[13px] font-bold text-ink">{title}</span>
        <span className="rounded-pill border border-attention bg-surface px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-attention-strong">
          Outward-facing
        </span>
      </div>

      <div className="space-y-3 bg-surface p-4">
        <p className="text-xs text-ink-3">{subtitle}</p>

        {email ? (
          <div className="space-y-2.5">
            <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-ink-2">
              <Mail className="h-4 w-4 text-brand" aria-hidden />
              Draft · {app || "Gmail"}
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              <label className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
                <span className="w-[52px] shrink-0 text-ink-4">To</span>
                <input
                  className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                  value={fields[toKey] ?? ""}
                  onChange={(e) => set(toKey, e.target.value)}
                  placeholder="name@example.com"
                />
              </label>
              <label className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
                <span className="w-[52px] shrink-0 text-ink-4">Subject</span>
                <input
                  className="min-w-0 flex-1 bg-transparent font-medium text-ink outline-none"
                  value={fields[subjectKey] ?? ""}
                  onChange={(e) => set(subjectKey, e.target.value)}
                  placeholder="Subject"
                />
              </label>
              <textarea
                className="w-full resize-y whitespace-pre-wrap bg-transparent px-3 py-3 text-[12.5px] leading-relaxed text-ink-2 outline-none"
                value={fields[bodyKey] ?? ""}
                onChange={(e) => set(bodyKey, e.target.value)}
                placeholder="Write your message…"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {otherKeys.length === 0 && <p className="text-sm text-ink-3">No inputs — just confirm.</p>}
            {otherKeys.map((k) => (
              <label key={k} className="block space-y-1">
                <span className="text-xs text-ink-3">{humanKey(k)}</span>
                {(fields[k] ?? "").length > 60 ? (
                  <textarea
                    className={`${inputCls} min-h-[80px] resize-y`}
                    value={fields[k] ?? ""}
                    onChange={(e) => set(k, e.target.value)}
                  />
                ) : (
                  <input className={inputCls} value={fields[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
                )}
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
          <Button
            size="sm"
            onClick={approve}
            className="gap-[7px] rounded-lg bg-brand text-on-brand shadow-sh-1 hover:bg-brand-2"
          >
            <Check className="h-[15px] w-[15px]" aria-hidden />
            {email ? "Approve & send" : "Approve"}
          </Button>
          <Button size="sm" variant="ghost" onClick={reject}>
            Reject
          </Button>
          <button
            type="button"
            onClick={always}
            className="px-1.5 py-2 text-xs font-semibold text-ink-3 transition-colors hover:text-ink"
          >
            {email ? "Always allow sending email" : "Always allow"}
          </button>
        </div>
      </div>
    </div>
  );
}
