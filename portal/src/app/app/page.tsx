import Link from "next/link";
import { Suspense } from "react";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildHomeData, type HomeActionRow, type HomeMeetingRow, type HomeRecapRow, type HomeSpaceRow } from "@/lib/home";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Greeting, firstName } from "@/components/home/Greeting";
import { AskBar } from "@/components/home/AskBar";
import { TodaysAgenda } from "@/components/home/TodaysAgenda";
import { RecentRecaps } from "@/components/home/RecentRecaps";
import { NeedsAction } from "@/components/home/NeedsAction";
import { SpacesPulse } from "@/components/home/SpacesPulse";
import { HomeSkeleton } from "@/components/home/HomeSkeleton";
import { DashboardError } from "@/components/home/DashboardError";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const user = await requireUserPage();
  const db = createServerClient(); // RLS-scoped reads

  // Check calendar connection — carried over from the previous meetings-home.
  const { data: conn } = await db
    .from("calendar_connections")
    .select("id,google_refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!conn) {
    return (
      <EmptyState
        icon={
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" fill="var(--on-brand)" />
            <path
              d="M6.5 6.5a7.8 7.8 0 000 11M17.5 6.5a7.8 7.8 0 010 11"
              stroke="var(--on-brand)"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        }
        title={`Welcome to MeetBase, ${firstName(user.email ?? "there")}`}
        body="Connect your calendar and MeetBase starts joining your meetings. Your day, your commitments, and everything said will roll up here."
        action={
          <Button asChild>
            <Link href="/welcome">Connect a calendar</Link>
          </Button>
        }
      />
    );
  }

  // Trigger calendar sync inline (fire-and-forget) — kept from the previous
  // meetings-home so meeting data stays fresh and the agenda/recaps below
  // reflect the latest calendar state without a separate sync step.
  if (conn.google_refresh_token) {
    const { syncUserMeetings } = await import("@/lib/meetings/sync");
    const service = createServiceClient(); // elevated: upsert may run without request cookies in the async tail
    syncUserMeetings(service, user.id, conn.google_refresh_token).catch(() => {});
  }

  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeDashboard userId={user.id} userEmail={user.email ?? "there"} />
    </Suspense>
  );
}

async function HomeDashboard({ userId, userEmail }: { userId: string; userEmail: string }) {
  try {
    const db = createServerClient();
    const now = new Date();
    const nowIso = now.toISOString();

    const [
      { data: upcomingRows },
      { data: pastRows },
      { data: spacesRows },
      { data: factRows },
      { data: unfiledRows },
      { data: actionRows },
      { data: profile },
    ] = await Promise.all([
      db.from("meetings")
        .select("id,title,start_time,meet_url,bot_status,space_id")
        .eq("user_id", userId)
        .gte("start_time", nowIso)
        .order("start_time"),
      db.from("meetings")
        .select("id,title,start_time,meet_url,bot_status,space_id")
        .eq("user_id", userId)
        .lt("start_time", nowIso)
        .eq("bot_status", "done")
        .order("start_time", { ascending: false })
        .limit(40),
      db.from("spaces").select("id,name").eq("user_id", userId).eq("status", "active"),
      db.from("space_facts").select("space_id").eq("user_id", userId).is("superseded_by", null),
      // Same "to review" definition as the Spaces page: only processed (done)
      // meetings with no confirmed home count toward the review queue.
      db.from("meetings")
        .select("id")
        .eq("user_id", userId)
        .eq("bot_status", "done")
        .or("space_source.in.(suggested,unfiled),space_id.is.null"),
      // RLS-scoped: action_items has no user_id column, scoping is via the meetings.user_id join.
      db.from("action_items").select("id,owner,task,due,done,meeting_id,meetings(title,space_id)").eq("done", false),
      db.from("profiles").select("display_name,timezone").eq("user_id", userId).maybeSingle(),
    ]);

    const timeZone = (profile?.timezone as string | null) ?? "UTC";

    const meetings = [...(upcomingRows ?? []), ...(pastRows ?? [])];
    const spaceNameById = new Map<string, string>((spacesRows ?? []).map((s) => [s.id as string, s.name as string]));
    const factCountBySpace = new Map<string, number>();
    for (const f of factRows ?? []) {
      const spaceId = f.space_id as string;
      factCountBySpace.set(spaceId, (factCountBySpace.get(spaceId) ?? 0) + 1);
    }

    const pastIds = (pastRows ?? []).map((m) => m.id);
    const tldrById = new Map<string, string>();
    if (pastIds.length) {
      const { data: sums } = await db.from("summaries").select("meeting_id,tldr").in("meeting_id", pastIds);
      for (const s of sums ?? []) if (s.tldr) tldrById.set(s.meeting_id, s.tldr);
    }

    const homeMeetings: HomeMeetingRow[] = meetings.map((m) => ({
      id: m.id as string,
      title: m.title as string,
      start_time: m.start_time as string,
      bot_status: m.bot_status as string,
      meet_url: (m.meet_url as string | null) ?? null,
    }));

    const recaps: HomeRecapRow[] = (pastRows ?? [])
      .filter((m) => tldrById.has(m.id as string))
      .map((m) => ({
        meeting_id: m.id as string,
        title: m.title as string,
        start_time: m.start_time as string,
        tldr: tldrById.get(m.id as string) as string,
        space_name: m.space_id ? spaceNameById.get(m.space_id as string) ?? null : null,
      }));

    const actions: HomeActionRow[] = (actionRows ?? []).map((r) => {
      const meetingRel = (r as unknown as { meetings: { title: string; space_id: string | null } | null }).meetings;
      return {
        id: r.id as string,
        owner: (r.owner as string) ?? "unassigned",
        task: r.task as string,
        due: (r.due as string | null) ?? null,
        done: Boolean(r.done),
        meeting_id: r.meeting_id as string,
        meeting_title: meetingRel?.title ?? "Meeting",
        space_name: meetingRel?.space_id ? spaceNameById.get(meetingRel.space_id) ?? null : null,
      };
    });

    const spacePulseRows: HomeSpaceRow[] = (spacesRows ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      open: factCountBySpace.get(s.id as string) ?? 0,
    }));

    const data = buildHomeData(
      {
        meetings: homeMeetings,
        actions,
        recaps,
        spaces: spacePulseRows,
        unfiledCount: unfiledRows?.length ?? 0,
      },
      now,
      timeZone,
    );

    const displayName = (profile?.display_name as string | null) ?? userEmail;

    return (
      <div className="mx-auto max-w-[1080px]">
        <Greeting
          displayName={displayName}
          now={now}
          timeZone={timeZone}
          meetingsToday={data.meetingsToday}
          openActions={data.openActions}
        />
        <AskBar />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <TodaysAgenda meetings={data.agenda} />
            <RecentRecaps recaps={data.recaps} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <NeedsAction actions={data.needsAction} />
            {data.reviewCount > 0 ? (
              <Link
                href="/app/spaces/unfiled"
                className="flex items-center gap-3 rounded-xl border border-attention bg-attention-weak px-4 py-[14px] hover:opacity-90"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-attention bg-surface text-attention-strong">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M12 8v5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                    <circle cx="12" cy="16.3" r="1.1" fill="currentColor" />
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-[13.5px] font-bold">
                    {data.reviewCount} meeting{data.reviewCount === 1 ? "" : "s"} need filing
                  </div>
                  <div className="text-xs text-ink-2">Confirm where MeetBase should file them</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-attention-strong">
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ) : null}
            <SpacesPulse spaces={data.spacesPulse} />
          </div>
        </div>
      </div>
    );
  } catch {
    return <DashboardError />;
  }
}
