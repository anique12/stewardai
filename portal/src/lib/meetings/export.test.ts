import { meetingToMarkdown } from "./export";

describe("meetingToMarkdown", () => {
  it("renders title, summary, decisions, and action items", () => {
    const md = meetingToMarkdown({
      title: "Acme Sync",
      startTime: "2026-07-09T15:00:00.000Z",
      summary: { tldr: "We agreed on scope.", decisions: [{ text: "Ship Friday" }], discrepancies: [] },
      actionItems: [{ owner: "Ann", task: "Send recap", due: "2026-07-10", done: false }],
    });
    expect(md).toContain("# Acme Sync");
    expect(md).toContain("We agreed on scope.");
    expect(md).toContain("- Ship Friday");
    expect(md).toContain("- [ ] @Ann — Send recap (due 2026-07-10)");
  });

  it("handles a sparse meeting with no summary or actions", () => {
    const md = meetingToMarkdown({
      title: "Quick chat", startTime: "2026-07-09T15:00:00.000Z", summary: null, actionItems: [],
    });
    expect(md).toContain("# Quick chat");
    expect(md).not.toContain("## Action items");
  });

  it("marks done items with a checked box and omits unassigned owner", () => {
    const md = meetingToMarkdown({
      title: "T", startTime: "2026-07-09T15:00:00.000Z", summary: null,
      actionItems: [{ owner: "unassigned", task: "Do thing", due: null, done: true }],
    });
    expect(md).toContain("- [x] Do thing");
  });
});
