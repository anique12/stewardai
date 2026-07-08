import { aggregateStatus } from "@/lib/meetings/aggregate-status";

describe("aggregateStatus", () => {
  it("any proposed → Needs approval", () => {
    expect(aggregateStatus([{ state: "done" }, { state: "proposed" }])).toEqual({ label: "Needs approval", tone: "amber" });
  });
  it("any running (no proposed) → Running…", () => {
    expect(aggregateStatus([{ state: "running" }, { state: "done" }])).toEqual({ label: "Running…", tone: "blue" });
  });
  it("all done → Done", () => {
    expect(aggregateStatus([{ state: "done" }, { state: "done" }])).toEqual({ label: "Done", tone: "green" });
  });
  it("any failed (no proposed/running) → Failed", () => {
    expect(aggregateStatus([{ state: "failed" }, { state: "done" }])).toEqual({ label: "Failed", tone: "red" });
  });
});
