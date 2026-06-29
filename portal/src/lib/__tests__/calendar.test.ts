import { buildMeetingUpsert } from "@/lib/calendar";

describe("buildMeetingUpsert", () => {
  const userId = "user-1";
  const event = {
    id: "evt-1",
    summary: "Weekly Sync",
    start: { dateTime: "2026-07-01T10:00:00Z" },
    end:   { dateTime: "2026-07-01T11:00:00Z" },
    conferenceData: {
      entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
    },
  } as unknown as import("googleapis").calendar_v3.Schema$Event;

  it("maps a Google event to a meetings upsert payload", () => {
    const row = buildMeetingUpsert(userId, event);
    expect(row.user_id).toBe(userId);
    expect(row.google_event_id).toBe("evt-1");
    expect(row.title).toBe("Weekly Sync");
    expect(row.meet_url).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("sets meet_url to null when no conferenceData", () => {
    const noConf = { ...event, conferenceData: undefined } as unknown as import("googleapis").calendar_v3.Schema$Event;
    const row = buildMeetingUpsert(userId, noConf);
    expect(row.meet_url).toBeNull();
  });

  it("uses 'Untitled' when summary is missing", () => {
    const noSummary = { ...event, summary: undefined } as unknown as import("googleapis").calendar_v3.Schema$Event;
    const row = buildMeetingUpsert(userId, noSummary);
    expect(row.title).toBe("Untitled");
  });
});
