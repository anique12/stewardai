"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ActionStepCard, ToolkitIcon, type AgentAction } from "./ActionStepCard";
import { aggregateStatus } from "@/lib/meetings/aggregate-status";

const TONE: Record<string, string> = {
  amber: "bg-attention-weak text-attention-strong border-attention-weak",
  blue: "bg-brand-weak text-brand-ink border-brand-weak-2",
  green: "bg-brand-weak text-brand-ink border-brand-weak-2",
  red: "bg-danger-weak text-danger-strong border-danger-weak",
  muted: "bg-surface-2 text-ink-3 border-line",
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
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-brand-weak-2 bg-surface px-2.5 py-1.5 text-xs text-ink-3 transition-colors hover:bg-surface-2"
          >
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="flex items-center gap-1">
              {actions.map((a) => <ToolkitIcon key={a.id} toolkit={a.toolkit} />)}
            </span>
            <span className="font-medium text-ink">
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
              className="flex items-center gap-1 text-[11px] text-ink-3 transition-colors hover:text-ink"
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
