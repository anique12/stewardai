import { buildHomeSections, deriveSeriesKey, groupMeetings, type MeetingListItem } from "@/lib/meetings/series";

const m = (over: Partial<MeetingListItem>): MeetingListItem => ({
  id: "x", title: "T", start_time: "2026-07-01T10:00:00Z", meet_url: null,
  opted_in: false, bot_status: "pending", recurring_event_id: null, google_event_id: "x", ...over,
});

describe("deriveSeriesKey", () => {
  it("strips a timestamp suffix from an instance id", () => {
    expect(deriveSeriesKey("abc123_20260702T140000Z")).toBe("abc123");
  });
  it("strips an all-day date suffix", () => {
    expect(deriveSeriesKey("abc123_20260702")).toBe("abc123");
  });
  it("returns the id unchanged when there is no timestamp suffix", () => {
    expect(deriveSeriesKey("plainid")).toBe("plainid");
    expect(deriveSeriesKey("has_underscore_but_not_ts")).toBe("has_underscore_but_not_ts");
  });
});

describe("groupMeetings", () => {
  const now = "2026-07-05T00:00:00Z";

  it("groups by stored recurring_event_id into a series with upcoming/past split", () => {
    const items = [
      m({ id: "a", recurring_event_id: "r1", start_time: "2026-07-02T10:00:00Z", bot_status: "done" }),
      m({ id: "b", recurring_event_id: "r1", start_time: "2026-07-09T10:00:00Z" }),
    ];
    const [entry] = groupMeetings(items, now);
    expect(entry.kind).toBe("series");
    const s = entry as Extract<typeof entry, { kind: "series" }>;
    expect(s.count).toBe(2);
    expect(s.past.map((x) => x.id)).toEqual(["a"]);
    expect(s.upcoming.map((x) => x.id)).toEqual(["b"]);
    expect(s.nextOccurrence?.id).toBe("b");
  });

  it("falls back to derived key for null recurring_event_id", () => {
    const items = [
      m({ id: "a", google_event_id: "r2_20260702T100000Z", start_time: "2026-07-02T10:00:00Z", bot_status: "done" }),
      m({ id: "b", google_event_id: "r2_20260709T100000Z", start_time: "2026-07-09T10:00:00Z" }),
    ];
    const [entry] = groupMeetings(items, now);
    expect(entry.kind).toBe("series");
  });

  it("treats a lone occurrence as a single entry", () => {
    const items = [m({ id: "solo", google_event_id: "solo", recurring_event_id: null })];
    const [entry] = groupMeetings(items, now);
    expect(entry.kind).toBe("single");
  });

  it("orders entries with upcoming ones (soonest first) before past-only ones", () => {
    const items = [
      m({ id: "pastonly", google_event_id: "p", start_time: "2026-07-01T10:00:00Z", bot_status: "done" }),
      m({ id: "soon", google_event_id: "s", start_time: "2026-07-06T10:00:00Z" }),
    ];
    const entries = groupMeetings(items, now);
    const firstId = entries[0].kind === "single" ? entries[0].meeting.id : entries[0].upcoming[0]?.id;
    expect(firstId).toBe("soon");
  });
});

describe("buildHomeSections", () => {
  const now = "2026-07-05T00:00:00Z";

  it("collapses a series to its next occurrence in upcoming but expands all past occurrences", () => {
    const items = [
      m({ id: "p1", recurring_event_id: "r1", start_time: "2026-07-02T10:00:00Z", bot_status: "done" }),
      m({ id: "p2", recurring_event_id: "r1", start_time: "2026-07-04T10:00:00Z", bot_status: "done" }),
      m({ id: "u1", recurring_event_id: "r1", start_time: "2026-07-09T10:00:00Z" }),
      m({ id: "u2", recurring_event_id: "r1", start_time: "2026-07-16T10:00:00Z" }),
    ];
    const { upcoming, past } = buildHomeSections(items, now);
    // only the next future occurrence surfaces, tagged with the series size
    expect(upcoming.map((r) => r.meeting.id)).toEqual(["u1"]);
    expect(upcoming[0].seriesCount).toBe(4);
    // every completed occurrence appears, most recent first
    expect(past.map((x) => x.id)).toEqual(["p2", "p1"]);
  });

  it("places one-offs in the correct section with seriesCount 1", () => {
    const items = [
      m({ id: "future", google_event_id: "f", start_time: "2026-07-06T10:00:00Z" }),
      m({ id: "old", google_event_id: "o", start_time: "2026-07-01T10:00:00Z", bot_status: "done" }),
    ];
    const { upcoming, past } = buildHomeSections(items, now);
    expect(upcoming.map((r) => r.meeting.id)).toEqual(["future"]);
    expect(upcoming[0].seriesCount).toBe(1);
    expect(past.map((x) => x.id)).toEqual(["old"]);
  });

  it("sorts upcoming ascending and past descending across mixed entries", () => {
    const items = [
      m({ id: "u_late", google_event_id: "a", start_time: "2026-07-20T10:00:00Z" }),
      m({ id: "u_soon", google_event_id: "b", start_time: "2026-07-06T10:00:00Z" }),
      m({ id: "p_old", google_event_id: "c", start_time: "2026-07-01T10:00:00Z", bot_status: "done" }),
      m({ id: "p_recent", google_event_id: "d", start_time: "2026-07-04T10:00:00Z", bot_status: "done" }),
    ];
    const { upcoming, past } = buildHomeSections(items, now);
    expect(upcoming.map((r) => r.meeting.id)).toEqual(["u_soon", "u_late"]);
    expect(past.map((x) => x.id)).toEqual(["p_recent", "p_old"]);
  });
});
