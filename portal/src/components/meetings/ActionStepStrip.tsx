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
      {/* Collapsed summary — smoothly collapses to nothing when expanded */}
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-card"
          >
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
        </div>
      </div>

      {/* Expanded steps — smoothly grows in; the summary above is gone */}
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-90" aria-hidden />
              Hide steps
            </button>
            {actions.map((action) => (
              <ActionStepCard
                key={action.id}
                action={action}
                meetingId={meetingId}
                onMutate={onMutate}
                variant="compact"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
