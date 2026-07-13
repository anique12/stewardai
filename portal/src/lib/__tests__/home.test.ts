import { buildHomeData, type HomeActionRow, type HomeMeetingRow, type HomeRecapRow, type HomeSpaceRow } from "@/lib/home";

const now = new Date("2026-07-13T15:00:00Z");

const meeting = (over: Partial<HomeMeetingRow>): HomeMeetingRow => ({
  id: "m1",
  title: "Standup",
  start_time: "2026-07-13T09:00:00Z",
  bot_status: "done",
  meet_url: null,
  ...over,
});

const action = (over: Partial<HomeActionRow>): HomeActionRow => ({
  id: "a1",
  owner: "unassigned",
  task: "Follow up",
  due: null,
  done: false,
  meeting_id: "m1",
  meeting_title: "Standup",
  space_name: null,
  ...over,
});

const recap = (over: Partial<HomeRecapRow>): HomeRecapRow => ({
  meeting_id: "m1",
  title: "Standup",
  start_time: "2026-07-12T09:00:00Z",
  tldr: "Shipped the thing.",
  space_name: null,
  ...over,
});

const space = (over: Partial<HomeSpaceRow>): HomeSpaceRow => ({
  id: "s1",
  name: "Acme",
  open: 0,
  ...over,
});

describe("buildHomeData", () => {
  it("only includes today's meetings in agenda, sorted by start_time", () => {
    const meetings = [
      meeting({ id: "yesterday", start_time: "2026-07-12T09:00:00Z" }),
      meeting({ id: "today-late", start_time: "2026-07-13T18:00:00Z" }),
      meeting({ id: "today-early", start_time: "2026-07-13T08:00:00Z" }),
      meeting({ id: "tomorrow", start_time: "2026-07-14T09:00:00Z" }),
    ];

    const result = buildHomeData(
      { meetings, actions: [], recaps: [], spaces: [], unfiledCount: 0 },
      now,
    );

    expect(result.agenda.map((m) => m.id)).toEqual(["today-early", "today-late"]);
    expect(result.meetingsToday).toBe(2);
  });

  it("counts only open (not done) action items", () => {
    const actions = [
      action({ id: "a", done: false }),
      action({ id: "b", done: true }),
      action({ id: "c", done: false }),
    ];

    const result = buildHomeData(
      { meetings: [], actions, recaps: [], spaces: [], unfiledCount: 0 },
      now,
    );

    expect(result.openActions).toBe(2);
    expect(result.needsAction.map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("sorts needsAction by due date ascending, nulls last, and caps at 5", () => {
    const actions = [
      action({ id: "no-due", due: null }),
      action({ id: "later", due: "2026-07-20" }),
      action({ id: "sooner", due: "2026-07-14" }),
      ...Array.from({ length: 5 }, (_, i) => action({ id: `extra-${i}`, due: `2026-08-0${i + 1}` })),
    ];

    const result = buildHomeData(
      { meetings: [], actions, recaps: [], spaces: [], unfiledCount: 0 },
      now,
    );

    expect(result.needsAction).toHaveLength(5);
    expect(result.needsAction[0].id).toBe("sooner");
    expect(result.needsAction[1].id).toBe("later");
  });

  it("only includes recaps with a tldr, most recent first, capped at 5", () => {
    const recaps = [
      recap({ meeting_id: "no-tldr", tldr: "", start_time: "2026-07-13T09:00:00Z" }),
      recap({ meeting_id: "older", start_time: "2026-07-01T09:00:00Z" }),
      recap({ meeting_id: "newer", start_time: "2026-07-12T09:00:00Z" }),
    ];

    const result = buildHomeData(
      { meetings: [], actions: [], recaps, spaces: [], unfiledCount: 0 },
      now,
    );

    expect(result.recaps.map((r) => r.meeting_id)).toEqual(["newer", "older"]);
  });

  it("sorts spacesPulse by open count descending", () => {
    const spaces = [
      space({ id: "low", open: 1 }),
      space({ id: "high", open: 9 }),
      space({ id: "mid", open: 4 }),
    ];

    const result = buildHomeData(
      { meetings: [], actions: [], recaps: [], spaces, unfiledCount: 0 },
      now,
    );

    expect(result.spacesPulse.map((s) => s.id)).toEqual(["high", "mid", "low"]);
  });

  it("passes through unfiledCount as reviewCount", () => {
    const result = buildHomeData(
      { meetings: [], actions: [], recaps: [], spaces: [], unfiledCount: 7 },
      now,
    );

    expect(result.reviewCount).toBe(7);
  });
});
