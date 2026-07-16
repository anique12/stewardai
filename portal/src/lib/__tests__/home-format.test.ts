import { agendaTimeParts, recapDateLabel } from "@/lib/home";

// 2:30 AM UTC on the 14th is 10:30 PM on the 13th in New York — so both the
// time-of-day AND the calendar day differ from the server's UTC rendering.
// This is exactly the "home shows wrong time / meeting page shows right time"
// bug: these helpers run server-side and must honor the user's timezone.
const iso = "2026-07-14T02:30:00Z";

describe("agendaTimeParts", () => {
  it("formats in the given timezone, not UTC", () => {
    expect(agendaTimeParts(iso, "America/New_York")).toEqual({ time: "10:30", ampm: "PM" });
    expect(agendaTimeParts(iso, "UTC")).toEqual({ time: "2:30", ampm: "AM" });
  });
});

describe("recapDateLabel", () => {
  it("uses the user's timezone for the calendar day", () => {
    expect(recapDateLabel(iso, "America/New_York")).toBe("Jul 13");
    expect(recapDateLabel(iso, "UTC")).toBe("Jul 14");
  });
});
