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
      "UTC",
    );

    expect(result.agenda.map((m) => m.id)).toEqual(["today-early", "today-late"]);
    expect(result.meetingsToday).toBe(2);
  });

  it("decides 'today' in the given IANA timezone, not the server/UTC day", () => {
    // now = 2026-07-13T15:00:00Z -> 08:00 in America/Los_Angeles (UTC-7 in July), still July 13 there.
    // This meeting is 21:30 UTC on July 13, i.e. 14:30 in Los Angeles — same LA calendar day as `now`.
    const laSameDayEvening = meeting({ id: "la-evening", start_time: "2026-07-13T21:30:00Z" });
    // This meeting is 06:30 UTC on July 14 — but only 23:30 on July 13 in Los Angeles, so it's
    // "today" in LA even though its UTC date is already the 14th.
    const laLateNightStillToday = meeting({ id: "la-late-night", start_time: "2026-07-14T06:30:00Z" });
    // This one is UTC-day-13 (matches UTC "today") but in LA it's still July 12 (16:30 local),
    // wait — 2026-07-13T00:30:00Z is 2026-07-12T17:30 in LA, so it's NOT today in LA.
    const utcTodayButLaYesterday = meeting({ id: "utc-today-la-yesterday", start_time: "2026-07-13T00:30:00Z" });

    const meetings = [laSameDayEvening, laLateNightStillToday, utcTodayButLaYesterday];

    const resultLA = buildHomeData(
      { meetings, actions: [], recaps: [], spaces: [], unfiledCount: 0 },
      now,
      "America/Los_Angeles",
    );
    expect(resultLA.agenda.map((m) => m.id).sort()).toEqual(["la-evening", "la-late-night"].sort());

    const resultUTC = buildHomeData(
      { meetings, actions: [], recaps: [], spaces: [], unfiledCount: 0 },
      now,
      "UTC",
    );
    expect(resultUTC.agenda.map((m) => m.id)).toEqual(["utc-today-la-yesterday", "la-evening"]);
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
      "UTC",
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
      "UTC",
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
      "UTC",
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
      "UTC",
    );

    expect(result.spacesPulse.map((s) => s.id)).toEqual(["high", "mid", "low"]);
  });

  it("passes through unfiledCount as reviewCount", () => {
    const result = buildHomeData(
      { meetings: [], actions: [], recaps: [], spaces: [], unfiledCount: 7 },
      now,
      "UTC",
    );

    expect(result.reviewCount).toBe(7);
  });
});
