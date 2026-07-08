"use client";

import { useRouter } from "next/navigation";
import { ActionStepCard, type AgentAction } from "./ActionStepCard";

const STATE_ORDER: Record<AgentAction["state"], number> = {
  proposed: 0,
  approved: 1,
  running: 2,
  done: 3,
  failed: 4,
};

export function AgentActionsPanel({
  actions: initial,
  meetingId,
}: {
  actions: AgentAction[];
  meetingId: string;
}) {
  const router = useRouter();
  function refresh() {
    router.refresh();
  }

  const sorted = [...initial].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]
  );

  if (!sorted.length) {
    return (
      <p className="text-muted-foreground">
        No actions proposed yet. Steward will suggest actions after the meeting.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((action) => (
        <ActionStepCard
          key={action.id}
          action={action}
          meetingId={meetingId}
          onMutate={refresh}
        />
      ))}
    </div>
  );
}
