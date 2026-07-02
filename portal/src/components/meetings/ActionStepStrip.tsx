"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ActionStepCard, ToolkitIcon, type AgentAction } from "./ActionStepCard";
import { aggregateStatus } from "@/lib/meetings/aggregate-status";

const TONE: Record<string, string> = {
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  green: "bg-green-500/15 text-green-400 border-green-500/30",
  red: "bg-red-500/15 text-red-400 border-red-500/30",
  muted: "bg-muted text-muted-foreground border-border",
};

export function ActionStepStrip({
  actions, meetingId, onMutate,
}: { actions: AgentAction[]; meetingId: string; onMutate: () => void }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  const status = aggregateStatus(actions);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-card"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        <span className="flex items-center gap-1">
          {actions.map((a) => <ToolkitIcon key={a.id} toolkit={a.toolkit} />)}
        </span>
        <span className="font-medium text-foreground">
          Steward ran {actions.length} step{actions.length > 1 ? "s" : ""}
        </span>
        {status.label && (
          <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] ${TONE[status.tone]}`}>
            {status.label}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
          {actions.map((action, i) => (
            <div key={action.id} className="relative">
              <span className="absolute -left-[1.35rem] top-3 text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
              <ActionStepCard action={action} meetingId={meetingId} onMutate={onMutate} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
