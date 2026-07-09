import { groupActionItems, type ActionRow } from "./actions";

const row = (over: Partial<ActionRow>): ActionRow => ({
  id: "1", owner: "unassigned", task: "t", due: null, done: false,
  meeting_id: "m1", meeting_title: "Sync", ...over,
});

describe("groupActionItems", () => {
  it("splits open and done", () => {
    const { open, done } = groupActionItems([
      row({ id: "a", done: false }),
      row({ id: "b", done: true }),
    ]);
    expect(open.map((r) => r.id)).toEqual(["a"]);
    expect(done.map((r) => r.id)).toEqual(["b"]);
  });

  it("sorts open by due ascending, nulls last", () => {
    const { open } = groupActionItems([
      row({ id: "a", due: null }),
      row({ id: "b", due: "2026-07-20" }),
      row({ id: "c", due: "2026-07-10" }),
    ]);
    expect(open.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});
