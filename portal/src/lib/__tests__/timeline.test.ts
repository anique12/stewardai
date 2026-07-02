import { buildTimeline } from "@/lib/meetings/timeline";

const seg = (seq: number, speaker = "A", text = "x") => ({ id: `s${seq}`, seq, speaker, text });
const act = (id: string, source_seq: number | null) => ({
  id, source_seq, toolkit: "gmail", title: "t", state: "proposed",
  action_slug: "GMAIL_SEND_EMAIL", args: {}, result: null, error: null, risk: "low",
});

describe("buildTimeline", () => {
  it("orders items by seq", () => {
    const { items } = buildTimeline([seg(2), seg(0), seg(1)], []);
    expect(items.map((i) => i.segment.seq)).toEqual([0, 1, 2]);
  });
  it("attaches an action to the segment with matching seq", () => {
    const { items, unattached } = buildTimeline([seg(0), seg(1)], [act("a", 1)]);
    expect(items[1].actions.map((a) => a.id)).toEqual(["a"]);
    expect(items[0].actions).toEqual([]);
    expect(unattached).toEqual([]);
  });
  it("sends null source_seq to unattached", () => {
    const { unattached } = buildTimeline([seg(0)], [act("a", null)]);
    expect(unattached.map((a) => a.id)).toEqual(["a"]);
  });
  it("sends non-matching source_seq to unattached", () => {
    const { items, unattached } = buildTimeline([seg(0)], [act("a", 5)]);
    expect(items[0].actions).toEqual([]);
    expect(unattached.map((a) => a.id)).toEqual(["a"]);
  });
});
