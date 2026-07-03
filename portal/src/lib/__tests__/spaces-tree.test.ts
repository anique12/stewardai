import { buildSpaceTree, type SpaceRow } from "@/lib/spaces/tree";

const s = (over: Partial<SpaceRow>): SpaceRow => ({
  id: "x", name: "X", parent_id: null, kind: null, status: "active", ...over,
});

describe("buildSpaceTree", () => {
  it("nests children under parents and sorts each level by name (case-insensitive)", () => {
    const rows = [
      s({ id: "acme", name: "Acme" }),
      s({ id: "renewal", name: "q3 renewal", parent_id: "acme" }),
      s({ id: "hiring", name: "hiring" }),
      s({ id: "onboard", name: "Onboarding", parent_id: "acme" }),
    ];
    const tree = buildSpaceTree(rows);
    expect(tree.map((n) => n.id)).toEqual(["acme", "hiring"]); // roots sorted: Acme, hiring
    expect(tree[0].children.map((n) => n.id)).toEqual(["onboard", "renewal"]); // Onboarding, q3 renewal
  });

  it("treats a space whose parent is missing/archived-out as a root", () => {
    const tree = buildSpaceTree([s({ id: "orphan", name: "Orphan", parent_id: "gone" })]);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
  });

  it("returns [] for no spaces", () => {
    expect(buildSpaceTree([])).toEqual([]);
  });
});
