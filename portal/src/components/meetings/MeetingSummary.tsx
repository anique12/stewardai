import { SummaryPanel } from "./SummaryPanel";
import { ActionItemsPanel } from "./ActionItemsPanel";
import { AgentActionsPanel } from "./AgentActionsPanel";
import type { AgentAction } from "./ActionStepCard";

type Summary = { tldr: string; decisions: { text: string }[]; discrepancies: { text: string }[] } | null;
type ActionItem = { id: string; owner: string; task: string; due: string | null; done: boolean };

export function MeetingSummary({
  summary, actionItems, agentActions, meetingId,
}: { summary: Summary; actionItems: ActionItem[]; agentActions: AgentAction[]; meetingId: string }) {
  return (
    <section className="space-y-5 rounded-lg border border-border bg-card/50 p-4">
      <SummaryPanel summary={summary} />
      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Actions &amp; tasks</h4>
        <AgentActionsPanel actions={agentActions} meetingId={meetingId} />
        <div className="mt-3">
          <ActionItemsPanel items={actionItems} />
        </div>
      </div>
    </section>
  );
}
