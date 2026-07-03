import { groupFacts, type FactRow } from "@/lib/spaces/facts";

const f = (over: Partial<FactRow>): FactRow => ({
  id: "x", kind: "decision", text: "T", owner: null, due: null, status: null,
  meeting_id: "m1", source_seq: null, superseded_by: null, ...over,
});

describe("groupFacts", () => {
  it("buckets by kind and drops superseded rows", () => {
    const g = groupFacts([
      f({ id: "d1", kind: "decision", text: "Dropped tier-3" }),
      f({ id: "r1", kind: "risk", text: "Renewal at risk" }),
      f({ id: "d2", kind: "decision", text: "old", superseded_by: "d1" }),
      f({ id: "a1", kind: "action_item", text: "Send quote" }),
    ]);
    expect(g.decision.map((x) => x.id)).toEqual(["d1"]); // d2 superseded → dropped
    expect(g.risk.map((x) => x.id)).toEqual(["r1"]);
    expect(g.action_item.map((x) => x.id)).toEqual(["a1"]);
    expect(g.date).toEqual([]);
    expect(g.open_question).toEqual([]);
  });
});
