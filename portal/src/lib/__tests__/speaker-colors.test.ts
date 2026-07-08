import { speakerColor } from "@/lib/meetings/speaker-colors";

describe("speakerColor", () => {
  it("is deterministic for the same name", () => {
    expect(speakerColor("Anique")).toEqual(speakerColor("Anique"));
  });
  it("returns non-empty bg and text classes", () => {
    const c = speakerColor("Sam");
    expect(c.bg).toMatch(/\S/);
    expect(c.text).toMatch(/\S/);
  });
  it("maps different names to (usually) different palette slots", () => {
    const names = ["A", "B", "C", "D", "E"];
    const slots = new Set(names.map((n) => speakerColor(n).bg));
    expect(slots.size).toBeGreaterThan(1);
  });
});
