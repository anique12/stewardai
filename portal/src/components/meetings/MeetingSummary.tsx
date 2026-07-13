import { ActionItemsPanel } from "./ActionItemsPanel";
import { AgentActionsPanel } from "./AgentActionsPanel";
import type { AgentAction } from "./ActionStepCard";

type Summary = {
  tldr: string;
  decisions: { text: string }[];
  discrepancies: { text: string }[];
} | null;
type ActionItem = { id: string; owner: string; task: string; due: string | null; done: boolean };

// One card per recap block — each is visually distinct so the reader never
// confuses the summary, the human to-dos, and what Steward did.
function Card({
  label,
  count,
  countTone = "muted",
  children,
}: {
  label: string;
  count?: number;
  countTone?: "muted" | "attention";
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sh-1">
      <div className="mb-[11px] flex items-center gap-2">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          {label}
        </span>
        {count !== undefined && (
          <span className={`font-mono text-[10px] ${countTone === "attention" ? "text-attention" : "text-ink-4"}`}>
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function MeetingSummary({
  summary,
  actionItems,
  agentActions,
  meetingId,
  live = false,
}: {
  summary: Summary;
  actionItems: ActionItem[];
  agentActions: AgentAction[];
  meetingId: string;
  live?: boolean;
}) {
  const decisions = summary?.decisions ?? [];
  const discrepancies = summary?.discrepancies ?? [];
  const hasAnything =
    summary?.tldr ||
    decisions.length ||
    discrepancies.length ||
    actionItems.length ||
    agentActions.length;

  if (!hasAnything) {
    return (
      <div className="rounded-lg border border-dashed border-line-2 bg-surface p-5 text-center text-sm text-ink-3">
        Summary and action items will appear after the meeting ends.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {summary?.tldr && (
        <div className="rounded-lg border border-line bg-surface p-4 shadow-sh-1">
          <div className="mb-[9px] flex items-center gap-2">
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Summary</span>
            {live && <span className="font-mono text-[9.5px] text-brand">· updating live</span>}
          </div>
          <p className="font-display text-[14.5px] leading-[1.6] text-ink-2">{summary.tldr}</p>
        </div>
      )}

      {decisions.length > 0 && (
        <Card label="Decisions" count={decisions.length}>
          <div className="flex flex-col gap-[11px]">
            {decisions.map((d, i) => (
              <div key={i} className="flex items-start gap-[9px]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="mt-[2px] shrink-0 text-brand">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M8.5 12l2.3 2.3L15.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[12.5px] leading-[1.5] text-ink">{d.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {discrepancies.length > 0 && (
        <Card label="Open questions & risks" count={discrepancies.length} countTone="attention">
          <div className="flex flex-col gap-[11px]">
            {discrepancies.map((d, i) => (
              <div key={i} className="flex items-start gap-[9px]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="mt-[2px] shrink-0 text-attention">
                  <path d="M12 8.5v4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  <circle cx="12" cy="16.3" r="1.1" fill="currentColor" />
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                <span className="text-[12.5px] leading-[1.5] text-ink">{d.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {actionItems.length > 0 && (
        <Card label="Action items" count={actionItems.filter((i) => !i.done).length} countTone="muted">
          <ActionItemsPanel items={actionItems} />
        </Card>
      )}

      {agentActions.length > 0 && (
        <div className="rounded-lg border border-brand-weak-2 bg-brand-weak p-4">
          <div className="mb-[13px] flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-brand">
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
              <path d="M7 7a7 7 0 000 10M17 7a7 7 0 010 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-ink">
              What Steward did
            </span>
          </div>
          <AgentActionsPanel actions={agentActions} meetingId={meetingId} />
        </div>
      )}
    </div>
  );
}
