import { PageHeader } from "@/components/app-shell/PageHeader";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// usage_logs has RLS enabled with NO policy, so it is only readable via the
// service-role client (below). Access is therefore gated in code: the product
// owner (OWNER_EMAILS) sees ALL users' spend for pricing; anyone else is scoped
// to their own rows via the user_id filter (the service client bypasses RLS, so
// that filter is the guard — never remove it for non-owners).
function ownerEmails(): string[] {
  return (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

type Row = {
  created_at: string;
  user_id: string | null;
  feature: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | string | null;
  status: string;
};

function usd(n: number): string {
  if (n === 0) return "$0";
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function num(n: number): string {
  return n.toLocaleString("en-US");
}

function sumBy<T>(rows: Row[], key: (r: Row) => T) {
  const m = new Map<T, { requests: number; tokens: number; cost: number }>();
  for (const r of rows) {
    const k = key(r);
    const agg = m.get(k) ?? { requests: 0, tokens: 0, cost: 0 };
    agg.requests += 1;
    agg.tokens += Number(r.total_tokens ?? 0);
    agg.cost += Number(r.cost_usd ?? 0);
    m.set(k, agg);
  }
  return Array.from(m.entries()).sort((a, b) => b[1].cost - a[1].cost);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: Array<Array<string>>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            {head.map((h, i) => (
              <th key={i} className={`px-4 py-2.5 font-medium ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-border/50 last:border-0">
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={`px-4 py-2.5 ${ci === 0 ? "text-foreground" : "text-right tabular-nums text-muted-foreground"}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function UsagePage() {
  const user = await requireUserPage();
  const isOwner = ownerEmails().includes((user.email || "").toLowerCase());

  const service = createServiceClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let query = service
    .from("usage_logs")
    .select("created_at,user_id,feature,model,input_tokens,output_tokens,total_tokens,cost_usd,status")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (!isOwner) query = query.eq("user_id", user.id);
  const { data, error } = await query;
  const rows = (data ?? []) as Row[];

  const totalCost = rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const totalTokens = rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0);
  const requests = rows.length;
  const errors = rows.filter((r) => r.status === "error").length;

  const byDay = sumBy(rows, (r) => r.created_at.slice(0, 10));
  const byFeature = sumBy(rows, (r) => r.feature);
  const byModel = sumBy(rows, (r) => r.model || "(unknown)");
  const byUser = sumBy(rows, (r) => r.user_id ?? "(system)");
  const topCost = [...rows]
    .sort((a, b) => Number(b.cost_usd ?? 0) - Number(a.cost_usd ?? 0))
    .slice(0, 20);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage & cost"
        subtitle={
          isOwner
            ? "All model usage across the product (last 30 days)."
            : "Your model usage (last 30 days)."
        }
      />

      {error ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Couldn&apos;t load usage. If the <code>usage_logs</code> table isn&apos;t created yet,
          apply migration <code>0013_usage_logs.sql</code>.
        </div>
      ) : requests === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No usage recorded in the last 30 days yet.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total cost" value={usd(totalCost)} />
            <Stat label="Total tokens" value={num(totalTokens)} />
            <Stat label="Requests" value={num(requests)} />
            <Stat
              label="Avg / request"
              value={usd(requests ? totalCost / requests : 0)}
            />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">By feature</h2>
            <Table
              head={["Feature", "Requests", "Tokens", "Cost"]}
              rows={byFeature.map(([k, v]) => [k, num(v.requests), num(v.tokens), usd(v.cost)])}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">By model</h2>
            <Table
              head={["Model", "Requests", "Tokens", "Cost"]}
              rows={byModel.map(([k, v]) => [k, num(v.requests), num(v.tokens), usd(v.cost)])}
            />
          </section>

          {isOwner && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">By user</h2>
              <Table
                head={["User", "Requests", "Cost"]}
                rows={byUser.map(([k, v]) => [k, num(v.requests), usd(v.cost)])}
              />
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">
              Per day{errors > 0 ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}
            </h2>
            <Table
              head={["Day", "Requests", "Tokens", "Cost"]}
              rows={byDay
                .slice()
                .sort((a, b) => (a[0] < b[0] ? 1 : -1))
                .map(([k, v]) => [k, num(v.requests), num(v.tokens), usd(v.cost)])}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Most expensive requests</h2>
            <Table
              head={["When", "Feature", "Model", "Tokens", "Cost"]}
              rows={topCost.map((r) => [
                new Date(r.created_at).toLocaleString("en-US"),
                r.feature,
                r.model || "(unknown)",
                num(Number(r.total_tokens ?? 0)),
                usd(Number(r.cost_usd ?? 0)),
              ])}
            />
          </section>
        </>
      )}
    </div>
  );
}
