import { toStatusPillStatus } from "../status-pill";

test("maps known bot_status values through unchanged", () => {
  expect(toStatusPillStatus("in_meeting")).toBe("in_meeting");
  expect(toStatusPillStatus("done")).toBe("done");
  expect(toStatusPillStatus("failed")).toBe("failed");
  expect(toStatusPillStatus("scheduled")).toBe("scheduled");
  expect(toStatusPillStatus("pending")).toBe("pending");
});

test("keeps 'joining' as its own state instead of collapsing it to done", () => {
  // The bot has been dispatched and is asking to join / in the waiting room —
  // it must not read as "Completed".
  expect(toStatusPillStatus("joining")).toBe("joining");
});

test("falls back to done for genuinely unknown statuses", () => {
  expect(toStatusPillStatus("something_new")).toBe("done");
  expect(toStatusPillStatus("")).toBe("done");
});

test("honours a caller-supplied fallback for unknown statuses", () => {
  // Upcoming-meeting lists (e.g. Today's Agenda) treat unknowns as scheduled.
  expect(toStatusPillStatus("something_new", "scheduled")).toBe("scheduled");
  // A known value ignores the fallback.
  expect(toStatusPillStatus("joining", "scheduled")).toBe("joining");
});
