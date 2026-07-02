import { cadenceLabel } from "@/lib/meetings/cadence";

const daily = ["2026-07-01T10:00:00Z", "2026-07-02T10:00:00Z", "2026-07-03T10:00:00Z"];
const weekly = ["2026-07-01T10:00:00Z", "2026-07-08T10:00:00Z", "2026-07-15T10:00:00Z"];
const biweekly = ["2026-07-01T10:00:00Z", "2026-07-15T10:00:00Z", "2026-07-29T10:00:00Z"];
const monthly = ["2026-07-01T10:00:00Z", "2026-07-31T10:00:00Z", "2026-08-30T10:00:00Z"];
const irregular = ["2026-07-01T10:00:00Z", "2026-07-04T10:00:00Z", "2026-08-01T10:00:00Z"];

describe("cadenceLabel", () => {
  it("detects daily", () => expect(cadenceLabel(daily)).toBe("Daily"));
  it("detects weekly", () => expect(cadenceLabel(weekly)).toBe("Weekly"));
  it("detects biweekly", () => expect(cadenceLabel(biweekly)).toBe("Biweekly"));
  it("detects monthly", () => expect(cadenceLabel(monthly)).toBe("Monthly"));
  it("falls back to Recurring for irregular gaps", () => expect(cadenceLabel(irregular)).toBe("Recurring"));
  it("falls back to Recurring for fewer than 2 times", () => expect(cadenceLabel(["2026-07-01T10:00:00Z"])).toBe("Recurring"));
  it("detects weekly with one skipped occurrence (majority of gaps in band)", () =>
    expect(
      cadenceLabel([
        "2026-07-01T10:00:00Z",
        "2026-07-08T10:00:00Z",
        "2026-07-22T10:00:00Z",
        "2026-07-29T10:00:00Z",
      ])
    ).toBe("Weekly"));
});
