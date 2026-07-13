/**
 * Pure derivation of "nudges" — small, dismissible surfaced-to-the-user
 * prompts shown in the Nudges bell/panel. No proactive engine: this is a
 * deterministic mapping from a handful of already-queried inputs to a list
 * of nudges, called fresh on every `/api/nudges` request.
 */

export type NudgeKind = "overdue_action" | "needs_filing" | "bot_failed";

export type Nudge = {
  kind: NudgeKind;
  title: string;
  body: string;
  act: string;
  href: string;
};

export type OverdueAction = {
  id: string;
  task: string;
  meetingTitle: string;
  due: string;
};

export type FailedMeeting = {
  id: string;
  title: string;
};

export type DeriveNudgesInput = {
  overdueActions: OverdueAction[];
  unfiledCount: number;
  failedMeetings: FailedMeeting[];
};

export function deriveNudges({ overdueActions, unfiledCount, failedMeetings }: DeriveNudgesInput): Nudge[] {
  const nudges: Nudge[] = [];

  // Most-overdue (earliest due date) first.
  const sortedOverdue = [...overdueActions].sort((a, b) => a.due.localeCompare(b.due));
  for (const action of sortedOverdue) {
    nudges.push({
      kind: "overdue_action",
      title: `Overdue: ${action.task}`,
      body: `From "${action.meetingTitle}" — was due ${action.due}.`,
      act: "View action items",
      href: "/app/actions",
    });
  }

  if (unfiledCount > 0) {
    nudges.push({
      kind: "needs_filing",
      title: "Meetings need filing",
      body: `${unfiledCount} processed meeting${unfiledCount === 1 ? "" : "s"} still need${
        unfiledCount === 1 ? "s" : ""
      } a space.`,
      act: "Review",
      href: "/app/spaces/unfiled",
    });
  }

  for (const meeting of failedMeetings) {
    nudges.push({
      kind: "bot_failed",
      title: "Steward couldn't join",
      body: `"${meeting.title}" failed to record.`,
      act: "View meeting",
      href: `/app/meetings/${meeting.id}`,
    });
  }

  return nudges;
}
