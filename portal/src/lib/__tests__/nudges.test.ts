import { deriveNudges } from "../nudges";

test("overdue action item becomes a nudge", () => {
  const n = deriveNudges({
    overdueActions: [{ id: "1", task: "Send deck", meetingTitle: "Acme", due: "2026-07-10" }],
    unfiledCount: 0,
    failedMeetings: [],
  });
  expect(n.some((x) => x.kind === "overdue_action")).toBe(true);
});

test("unfiled meetings become a needs_filing nudge with a count in the body", () => {
  const n = deriveNudges({ overdueActions: [], unfiledCount: 3, failedMeetings: [] });
  const nudge = n.find((x) => x.kind === "needs_filing");
  expect(nudge).toBeTruthy();
  expect(nudge?.href).toBe("/app/spaces/unfiled");
  expect(nudge?.body).toMatch(/3/);
});

test("zero unfiled count produces no needs_filing nudge", () => {
  const n = deriveNudges({ overdueActions: [], unfiledCount: 0, failedMeetings: [] });
  expect(n.some((x) => x.kind === "needs_filing")).toBe(false);
});

test("a failed meeting becomes a bot_failed nudge linking to the meeting", () => {
  const n = deriveNudges({
    overdueActions: [],
    unfiledCount: 0,
    failedMeetings: [{ id: "m1", title: "Weekly sync" }],
  });
  const nudge = n.find((x) => x.kind === "bot_failed");
  expect(nudge).toBeTruthy();
  expect(nudge?.href).toBe("/app/meetings/m1");
});

test("multiple overdue actions each produce their own nudge, most-overdue first", () => {
  const n = deriveNudges({
    overdueActions: [
      { id: "1", task: "Send deck", meetingTitle: "Acme", due: "2026-07-01" },
      { id: "2", task: "Follow up", meetingTitle: "Beta", due: "2026-06-01" },
    ],
    unfiledCount: 0,
    failedMeetings: [],
  });
  const overdue = n.filter((x) => x.kind === "overdue_action");
  expect(overdue).toHaveLength(2);
  expect(overdue[0].href).toBe("/app/actions");
});

test("empty inputs produce no nudges", () => {
  expect(deriveNudges({ overdueActions: [], unfiledCount: 0, failedMeetings: [] })).toEqual([]);
});
