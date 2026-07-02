import { ActionItemsPanel } from "./ActionItemsPanel";
import { AgentActionsPanel } from "./AgentActionsPanel";
import type { AgentAction } from "./ActionStepCard";

type Summary = {
  tldr: string;
  decisions: { text: string }[];
  discrepancies: { text: string }[];
} | null;
type ActionItem = { id: string; owner: string; task: string; due: string | null; done: boolean };

// One clearly-labeled block. Sections are separated by a divider so the reader
// never confuses the summary, the human to-dos, and what Steward did.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/60 pt-4 first:border-0 first:pt-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function MeetingSummary({
  summary,
  actionItems,
  agentActions,
  meetingId,
}: {
  summary: Summary;
  actionItems: ActionItem[];
  agentActions: AgentAction[];
  meetingId: string;
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
      <div className="rounded-lg border border-border bg-card/50 p-5 text-sm text-muted-foreground">
        Summary and action items will appear after the meeting ends.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/50 p-5">
      {summary?.tldr && (
        <Section title="Summary">
          <p className="text-sm leading-relaxed text-foreground/90">{summary.tldr}</p>
        </Section>
      )}

      {decisions.length > 0 && (
        <Section title="Decisions">
          <ul className="space-y-1.5 text-sm text-foreground/90">
            {decisions.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                <span>{d.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {actionItems.length > 0 && (
        <Section title="Action items">
          <ActionItemsPanel items={actionItems} />
        </Section>
      )}

      {discrepancies.length > 0 && (
        <Section title="Open questions">
          <ul className="space-y-1.5 text-sm text-amber-300/90">
            {discrepancies.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/70" />
                <span>{d.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {agentActions.length > 0 && (
        <Section title="Steward's actions">
          <AgentActionsPanel actions={agentActions} meetingId={meetingId} />
        </Section>
      )}
    </div>
  );
}
