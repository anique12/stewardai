import { aggregateUsage, type UsageRow } from "@/lib/usage";

const now = new Date("2026-07-13T12:00:00Z");

const row = (over: Partial<UsageRow>): UsageRow => ({
  created_at: "2026-07-13T09:00:00Z",
  user_id: "u1",
  feature: "chat",
  model: "gpt-4o",
  total_tokens: 100,
  cost_usd: 0.01,
  status: "ok",
  ...over,
});

describe("aggregateUsage", () => {
  it("buckets logs into per-week groups and scales stacked bar heights (max stack = 140px)", () => {
    const logs: UsageRow[] = [
      // Oldest week (~3 weeks back within the 30d window): 1 chat call only.
      row({ created_at: "2026-06-23T09:00:00Z", feature: "chat" }),
      // Most recent week: 2 chat, 1 ask, 1 summary — the tallest stack (total 4).
      row({ created_at: "2026-07-12T09:00:00Z", feature: "chat" }),
      row({ created_at: "2026-07-11T09:00:00Z", feature: "chat" }),
      row({ created_at: "2026-07-10T09:00:00Z", feature: "ask" }),
      row({ created_at: "2026-07-09T09:00:00Z", feature: "summary" }),
    ];

    const result = aggregateUsage(logs, 30, now);

    // 30d window bucketed into 5 weekly bars.
    expect(result.perWeekBars).toHaveLength(5);

    const newest = result.perWeekBars[result.perWeekBars.length - 1];
    expect(newest.chatH).toBeCloseTo(70); // 2/4 * 140
    expect(newest.askH).toBeCloseTo(35); // 1/4 * 140
    expect(newest.sumH).toBeCloseTo(35); // 1/4 * 140

    const oldestWithData = result.perWeekBars.find((b) => b.chatH > 0 && b.d !== newest.d);
    expect(oldestWithData).toBeDefined();
    expect(oldestWithData!.chatH).toBeCloseTo(35); // 1/4 * 140
    expect(oldestWithData!.askH).toBe(0);
    expect(oldestWithData!.sumH).toBe(0);
  });

  it("sums cost and requests correctly into stats + total", () => {
    const logs: UsageRow[] = [
      row({ feature: "chat", cost_usd: 0.02, total_tokens: 200, status: "ok" }),
      row({ feature: "ask", cost_usd: 0.03, total_tokens: 300, status: "error" }),
      row({ feature: "summary", cost_usd: "0.05", total_tokens: 500, status: "ok" }),
    ];

    const result = aggregateUsage(logs, 30, now);

    expect(result.total.calls).toBe("3");
    expect(result.total.cost).toBe("$0.10");

    const requestsStat = result.stats.find((s) => s.label === "Requests");
    expect(requestsStat?.value).toBe("3");

    const costStat = result.stats.find((s) => s.label === "Total cost");
    expect(costStat?.value).toBe("$0.10");
  });

  it("groups rows by feature with call counts, cost totals, and tone", () => {
    const logs: UsageRow[] = [
      row({ feature: "chat", cost_usd: 0.05 }),
      row({ feature: "chat", cost_usd: 0.05 }),
      row({ feature: "ask", cost_usd: 0.03 }),
    ];

    const result = aggregateUsage(logs, 30, now);

    const chat = result.byFeature.find((f) => f.label === "chat");
    const ask = result.byFeature.find((f) => f.label === "ask");

    expect(chat?.calls).toBe("2");
    expect(chat?.cost).toBe("0.10");
    expect(chat?.tone).toBe("var(--brand)");

    expect(ask?.calls).toBe("1");
    expect(ask?.cost).toBe("0.03");
    expect(ask?.tone).toBe("var(--attention)");

    // Sorted by combined cost desc: chat's total (0.10) beats ask's (0.03).
    expect(result.byFeature[0].label).toBe("chat");
  });

  it("returns empty aggregation for no logs", () => {
    const result = aggregateUsage([], 30, now);
    expect(result.total.calls).toBe("0");
    expect(result.total.cost).toBe("$0.00");
    expect(result.byFeature).toEqual([]);
    expect(result.perWeekBars.every((b) => b.chatH === 0 && b.askH === 0 && b.sumH === 0)).toBe(true);
  });
});
