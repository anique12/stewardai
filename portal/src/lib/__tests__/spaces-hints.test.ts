import { deriveHints, type HintEntity } from "@/lib/spaces/hints";

const e = (over: Partial<HintEntity>): HintEntity => ({ kind: "person", email: null, domain: null, ...over });

describe("deriveHints", () => {
  it("maps person email → attendee_email and company domain → domain, lower-cased + deduped", () => {
    const rows = deriveHints(
      [
        e({ kind: "person", email: "Jane@Acme.com" }),
        e({ kind: "person", email: "jane@acme.com" }), // dup after lower-casing
        e({ kind: "company", domain: "ACME.com" }),
        e({ kind: "company", email: "x@globex.io", domain: null }), // domain from email
        e({ kind: "person", email: null }), // no signal → skipped
      ],
      "space-1",
      "user-1"
    );
    expect(rows).toEqual([
      { user_id: "user-1", kind: "attendee_email", value: "jane@acme.com", space_id: "space-1", weight: 1 },
      { user_id: "user-1", kind: "domain", value: "acme.com", space_id: "space-1", weight: 1 },
      { user_id: "user-1", kind: "domain", value: "globex.io", space_id: "space-1", weight: 1 },
    ]);
  });

  it("returns [] when nothing has a usable signal", () => {
    expect(deriveHints([e({ kind: "person", email: null })], "s", "u")).toEqual([]);
  });
});
