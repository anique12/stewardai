export type FactKind = "action_item" | "decision" | "date" | "risk" | "open_question";

export type FactRow = {
  id: string;
  kind: FactKind;
  text: string;
  owner: string | null;
  due: string | null;
  status: string | null;
  meeting_id: string | null;
  source_seq: number | null;
  superseded_by: string | null;
};

export type GroupedFacts = Record<FactKind, FactRow[]>;

const EMPTY = (): GroupedFacts => ({
  action_item: [], decision: [], date: [], risk: [], open_question: [],
});

/** Group live (non-superseded) facts by kind, preserving input order per kind. */
export function groupFacts(facts: FactRow[]): GroupedFacts {
  const out = EMPTY();
  for (const fact of facts) {
    if (fact.superseded_by) continue;
    if (fact.kind in out) out[fact.kind].push(fact);
  }
  return out;
}
