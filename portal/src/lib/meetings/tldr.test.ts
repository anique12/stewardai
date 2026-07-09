import { cleanTldr } from "./tldr";

describe("cleanTldr", () => {
  it("returns null for empty/absent input", () => {
    expect(cleanTldr(null)).toBeNull();
    expect(cleanTldr(undefined)).toBeNull();
    expect(cleanTldr("   ")).toBeNull();
  });

  it("suppresses LLM refusal text about missing transcripts", () => {
    const refusals = [
      "No meeting transcript was provided, so no summary, decisions, action items, or discrepancies can be extracted.",
      "No meeting transcript was provided. Therefore, no summary, decisions, action items, or discrepancies can be extracted.",
      "I need a transcript to summarize the meeting. Please provide the speaker-labeled transcript.",
      "I need a transcript of the meeting to summarize it. Please provide the speaker-labeled transcript.",
      "No transcript was provided, so no meeting summary can be generated. Please provide the transcript for analysis.",
    ];
    for (const r of refusals) expect(cleanTldr(r)).toBeNull();
  });

  it("keeps a genuine summary", () => {
    const real = "We agreed to ship Friday and Ann will send the recap.";
    expect(cleanTldr(real)).toBe(real);
  });

  it("trims surrounding whitespace on a real summary", () => {
    expect(cleanTldr("  Scope locked for v2.  ")).toBe("Scope locked for v2.");
  });
});
