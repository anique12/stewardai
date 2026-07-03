import { splitAnswerWithCitations, askQuestion, type AskResult } from "./client";

describe("splitAnswerWithCitations", () => {
  it("splits [n] markers into text + citation tokens", () => {
    const parts = splitAnswerWithCitations("We ship Friday [1] and [2].");
    expect(parts).toEqual([
      { type: "text", value: "We ship Friday " },
      { type: "cite", n: 1 },
      { type: "text", value: " and " },
      { type: "cite", n: 2 },
      { type: "text", value: "." },
    ]);
  });

  it("returns a single text part when there are no citations", () => {
    expect(splitAnswerWithCitations("No sources here.")).toEqual([
      { type: "text", value: "No sources here." },
    ]);
  });
});

describe("askQuestion", () => {
  it("POSTs the query with a bearer token and returns the parsed result", async () => {
    const result: AskResult = { answer: "hi [1]", citations: [
      { n: 1, meeting_id: "m1", source_seq: 3, kind: "segment", snippet: "s" },
    ] };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => result,
    });
    global.fetch = fetchMock;

    const out = await askQuestion(
      { baseUrl: "https://api.example", token: "tok" },
      { query: "when?", spaceId: null },
    );
    expect(out).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example/api/ask");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ query: "when?", space_id: null });
  });

  it("throws on a non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(
      askQuestion({ baseUrl: "https://api.example", token: "t" }, { query: "q", spaceId: null }),
    ).rejects.toThrow();
  });
});
