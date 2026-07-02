export type Segment = {
  id: string; seq: number; speaker: string; text: string; created_at?: string;
};
export type TimelineAction = {
  id: string; source_seq: number | null; toolkit: string | null; title: string | null;
  state: string; action_slug: string | null; args: Record<string, unknown>;
  result: Record<string, unknown> | null; error: string | null; risk: string | null;
};
export type TimelineItem = { segment: Segment; actions: TimelineAction[] };

export function buildTimeline(
  segments: Segment[],
  actions: TimelineAction[],
): { items: TimelineItem[]; unattached: TimelineAction[] } {
  const ordered = [...segments].sort((a, b) => a.seq - b.seq);
  const bySeq = new Map<number, TimelineItem>();
  const items: TimelineItem[] = ordered.map((segment) => {
    const item = { segment, actions: [] as TimelineAction[] };
    bySeq.set(segment.seq, item);
    return item;
  });
  const unattached: TimelineAction[] = [];
  for (const action of actions) {
    const target = action.source_seq != null ? bySeq.get(action.source_seq) : undefined;
    if (target) target.actions.push(action);
    else unattached.push(action);
  }
  return { items, unattached };
}
