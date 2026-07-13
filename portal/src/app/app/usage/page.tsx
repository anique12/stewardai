import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { aggregateUsage, type UsageRange, type UsageRow } from "@/lib/usage";
import { UsageRangeToggle } from "@/components/usage/UsageRangeToggle";
import { UsageSkeleton } from "@/components/usage/UsageSkeleton";
import { UsageError } from "@/components/usage/UsageError";
import { UsageChart } from "@/components/usage/UsageChart";
import { UsageFeatureTable } from "@/components/usage/UsageFeatureTable";

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

function parseRange(v: string | undefined): UsageRange {
  if (v === "7") return 7;
  if (v === "90") return 90;
  return 30;
}

function dateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams?: { range?: string };
}) {
  const user = await requireUserPage();
  const range = parseRange(searchParams?.range);

  return (
    <div className="mx-auto max-w-[1080px] space-y-6">
      <PageHeader
        title="Usage & cost"
        subtitle={
          user.email && ownerEmails().includes(user.email.toLowerCase())
            ? "All model usage across the product."
            : "Your model usage."
        }
        action={<UsageRangeToggle range={range} />}
      />

      <Suspense fallback={<UsageSkeleton />}>
        <UsageDashboard userId={user.id} userEmail={user.email ?? null} range={range} />
      </Suspense>
    </div>
  );
}

async function UsageDashboard({
  userId,
  userEmail,
  range,
}: {
  userId: string;
  userEmail: string | null;
  range: UsageRange;
}) {
  const isOwner = ownerEmails().includes((userEmail || "").toLowerCase());

  const service = createServiceClient();
  const now = new Date();
  const since = new Date(now.getTime() - range * 24 * 60 * 60 * 1000).toISOString();
  let query = service
    .from("usage_logs")
    .select("created_at,user_id,feature,model,total_tokens,cost_usd,status")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (!isOwner) query = query.eq("user_id", userId);
  const { data, error } = await query;

  if (error) {
    return <UsageError />;
  }

  const rows = (data ?? []) as UsageRow[];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 20V10M10 20V4M16 20v-7M22 20H2"
              stroke="var(--on-brand)"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        }
        title="No usage yet"
        body="Once Steward starts processing meetings, your consumption and cost breakdown will appear here."
      />
    );
  }

  const { stats, perWeekBars, byFeature, total } = aggregateUsage(rows, range, now);

  return (
    <div>
      <p className="mb-[22px] -mt-2 text-[13px] text-ink-3">
        {dateLabel(new Date(since))} – {dateLabel(now)}
      </p>

      <div className="mb-[22px] grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {stats.map((st) => (
          <div key={st.label} className="rounded-xl border border-line bg-surface p-[15px]">
            <div className="font-display text-2xl font-extrabold tracking-tight text-ink">{st.value}</div>
            <div className="mt-0.5 text-xs text-ink-2">{st.label}</div>
            <div className="mt-[5px] font-mono text-[10px] text-ink-4">{st.sub}</div>
          </div>
        ))}
      </div>

      <UsageChart bars={perWeekBars} />

      <UsageFeatureTable rows={byFeature} total={total} />
    </div>
  );
}
