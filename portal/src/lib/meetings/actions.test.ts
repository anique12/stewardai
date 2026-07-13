import { bucketActions, groupActionItems, type ActionRow } from "./actions";

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

describe("bucketActions", () => {
  // "now" pinned mid-day UTC on 2026-07-13, matching the currentDate context
  // used elsewhere in this branch's tests.
  const now = new Date("2026-07-13T15:00:00.000Z");

  it("classifies an open item due before today as overdue", () => {
    const { open, stats } = bucketActions([row({ id: "a", due: "2026-07-10" })], now);
    expect(open.overdue.map((r) => r.id)).toEqual(["a"]);
    expect(open.today).toEqual([]);
    expect(open.upcoming).toEqual([]);
    expect(open.noDate).toEqual([]);
    expect(stats).toEqual({ open: 1, overdue: 1, today: 0, done: 0 });
  });

  it("classifies an open item due today as today, not overdue", () => {
    const { open, stats } = bucketActions([row({ id: "a", due: "2026-07-13" })], now);
    expect(open.today.map((r) => r.id)).toEqual(["a"]);
    expect(open.overdue).toEqual([]);
    expect(stats.today).toBe(1);
    expect(stats.overdue).toBe(0);
  });

  it("classifies an open item due after today as upcoming", () => {
    const { open, stats } = bucketActions([row({ id: "a", due: "2026-07-20" })], now);
    expect(open.upcoming.map((r) => r.id)).toEqual(["a"]);
    expect(open.overdue).toEqual([]);
    expect(open.today).toEqual([]);
    expect(stats.overdue).toBe(0);
    expect(stats.today).toBe(0);
  });

  it("puts undated open items in noDate and excludes them from overdue/today", () => {
    const { open } = bucketActions([row({ id: "a", due: null })], now);
    expect(open.noDate.map((r) => r.id)).toEqual(["a"]);
    expect(open.overdue).toEqual([]);
    expect(open.today).toEqual([]);
    expect(open.upcoming).toEqual([]);
  });

  it("separates done items into `done` and counts them in stats, not in open buckets", () => {
    const { open, done, stats } = bucketActions(
      [row({ id: "a", due: "2026-07-10", done: true }), row({ id: "b", due: "2026-07-10", done: false })],
      now,
    );
    expect(done.map((r) => r.id)).toEqual(["a"]);
    expect(open.overdue.map((r) => r.id)).toEqual(["b"]);
    expect(stats).toEqual({ open: 1, overdue: 1, today: 0, done: 1 });
  });

  it("computes stats.open as the total count across all open buckets", () => {
    const { stats } = bucketActions(
      [
        row({ id: "a", due: "2026-07-10" }), // overdue
        row({ id: "b", due: "2026-07-13" }), // today
        row({ id: "c", due: "2026-07-20" }), // upcoming
        row({ id: "d", due: null }), // noDate
        row({ id: "e", done: true }),
      ],
      now,
    );
    expect(stats).toEqual({ open: 4, overdue: 1, today: 1, done: 1 });
  });

  it("respects an explicit timezone when classifying today vs overdue near midnight UTC", () => {
    // 2026-07-13T23:30:00Z is still 2026-07-13 in UTC, but already
    // 2026-07-14 in a UTC+1 zone — so a due date of 2026-07-14 should read
    // as "today" there, not "upcoming".
    const lateNow = new Date("2026-07-13T23:30:00.000Z");
    const { open } = bucketActions([row({ id: "a", due: "2026-07-14" })], lateNow, "Europe/Paris");
    expect(open.today.map((r) => r.id)).toEqual(["a"]);
  });
});
