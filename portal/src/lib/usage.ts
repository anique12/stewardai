// Pure aggregation for the Usage & cost page. Consumes already-fetched
// `usage_logs` rows (owner-vs-own-rows filtering happens in the page, before
// this ever runs) and produces the view model the restyled page renders:
// stat tiles, a "meetings processed per week" stacked bar chart, and a
// per-feature cost table + grand total.

export type UsageRow = {
  created_at: string;
  user_id: string | null;
  feature: string;
  model: string;
  total_tokens: number | null;
  cost_usd: number | string | null;
  status: string;
};

export type UsageRange = 7 | 30 | 90;

export interface UsageStat {
  label: string;
  value: string;
  sub: string;
}

export interface UsagePerWeekBar {
  /** Short label under the bar, e.g. "Jun 9". */
  d: string;
  /** Stacked segment heights in px (bottom→top: chat, ask, summary). */
  chatH: number;
  askH: number;
  sumH: number;
}

export interface UsageFeatureRow {
  label: string;
  calls: string;
  cost: string;
  tone: string;
}

export interface UsageData {
  stats: UsageStat[];
  perWeekBars: UsagePerWeekBar[];
  byFeature: UsageFeatureRow[];
  total: { calls: string; cost: string };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BAR_PX = 140;

// Known features get a fixed color from the design's paper token palette;
// anything else falls back to a neutral tone rather than being dropped.
const FEATURE_TONES: Record<string, string> = {
  chat: "var(--brand)",
  ask: "var(--attention)",
  summary: "var(--ink-3)",
};
const FALLBACK_TONE = "var(--ink-4)";

function toneFor(feature: string): string {
  return FEATURE_TONES[feature] ?? FALLBACK_TONE;
}

function usd(n: number): string {
  return n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function num(n: number): string {
  return n.toLocaleString("en-US");
}

// Short "Mon D" label, UTC-based so the pure function has no local-timezone
// dependency (the page can localize the range subtitle separately).
function shortLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

export function aggregateUsage(logs: UsageRow[], range: UsageRange, now: Date = new Date()): UsageData {
  const bucketCount = Math.ceil(range / 7);
  const rangeStart = now.getTime() - range * 24 * 60 * 60 * 1000;

  // Bucket index 0 = oldest week, bucketCount-1 = most recent (partial) week.
  const buckets: { chat: number; ask: number; summary: number; start: Date }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = new Date(now.getTime() - (bucketCount - i) * WEEK_MS);
    buckets.push({ chat: 0, ask: 0, summary: 0, start });
  }

  let totalCost = 0;
  let totalTokens = 0;
  let errors = 0;
  const featureAgg = new Map<string, { calls: number; cost: number }>();

  for (const r of logs) {
    const created = new Date(r.created_at).getTime();
    const cost = Number(r.cost_usd ?? 0);
    totalCost += cost;
    totalTokens += Number(r.total_tokens ?? 0);
    if (r.status === "error") errors += 1;

    const f = featureAgg.get(r.feature) ?? { calls: 0, cost: 0 };
    f.calls += 1;
    f.cost += cost;
    featureAgg.set(r.feature, f);

    if (created < rangeStart) continue;
    let idx = bucketCount - 1 - Math.floor((now.getTime() - created) / WEEK_MS);
    idx = Math.min(Math.max(idx, 0), bucketCount - 1);
    if (r.feature === "chat") buckets[idx].chat += 1;
    else if (r.feature === "ask") buckets[idx].ask += 1;
    else if (r.feature === "summary") buckets[idx].summary += 1;
  }

  const maxStack = Math.max(1, ...buckets.map((b) => b.chat + b.ask + b.summary));
  const perWeekBars: UsagePerWeekBar[] = buckets.map((b) => ({
    d: shortLabel(b.start),
    chatH: (b.chat / maxStack) * MAX_BAR_PX,
    askH: (b.ask / maxStack) * MAX_BAR_PX,
    sumH: (b.summary / maxStack) * MAX_BAR_PX,
  }));

  const byFeature: UsageFeatureRow[] = Array.from(featureAgg.entries())
    .map(([label, v]) => ({
      label,
      calls: num(v.calls),
      cost: v.cost.toFixed(2),
      tone: toneFor(label),
    }))
    .sort((a, b) => Number(b.cost) - Number(a.cost));

  const totalCalls = logs.length;
  const stats: UsageStat[] = [
    { label: "Total cost", value: usd(totalCost), sub: `${num(totalCalls)} calls` },
    { label: "Requests", value: num(totalCalls), sub: `${num(errors)} failed` },
    { label: "Avg cost / call", value: usd(totalCalls ? totalCost / totalCalls : 0), sub: `${range}d window` },
    { label: "Tokens used", value: num(totalTokens), sub: `${byFeature.length} feature${byFeature.length === 1 ? "" : "s"}` },
  ];

  return {
    stats,
    perWeekBars,
    byFeature,
    total: { calls: num(totalCalls), cost: usd(totalCost) },
  };
}
