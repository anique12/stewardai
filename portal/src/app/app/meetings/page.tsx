import { Suspense } from "react";
import Link from "next/link";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildHomeSections, type MeetingListItem, type UpcomingRow } from "@/lib/meetings/series";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { InstantJoin } from "@/components/meetings/InstantJoin";
import { MeetingsHeader, type MeetingsTab } from "@/components/meetings/MeetingsHeader";
import { LiveNowCard, type LiveMeeting } from "@/components/meetings/LiveNowCard";
import { UpcomingGroups, type UpcomingMeeting } from "@/components/meetings/UpcomingGroups";
import { PastList, type PastMeeting } from "@/components/meetings/PastList";
import { MeetingsError } from "@/components/meetings/MeetingsError";
import { MeetingsSkeleton } from "@/components/meetings/MeetingsSkeleton";

export const dynamic = "force-dynamic";

// Calendar-day string ("YYYY-MM-DD") for a Date, as observed in `timeZone` —
// same dependency-free IANA-aware trick as lib/home.ts's localDateKey.
function localDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function isSameDayInTimeZone(iso: string, now: Date, timeZone: string): boolean {
  return localDateKey(new Date(iso), timeZone) === localDateKey(now, timeZone);
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const user = await requireUserPage();
  const db = createServerClient(); // RLS-scoped reads
  const tab: MeetingsTab = searchParams?.tab === "past" ? "past" : "upcoming";

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
            <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="var(--on-brand)" strokeWidth="1.6" />
            <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="var(--on-brand)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        }
        title="Connect a calendar to begin"
        body={
          <>
            Steward reads your schedule to know when to show up. It joins only the meetings you opt
            into — and asks for <strong className="text-ink">read-only</strong> calendar access,
            nothing more.
          </>
        }
        action={
          <div className="flex flex-col items-center gap-5">
            <Button asChild>
              <Link href="/app/settings?connect=calendar">Connect Google Calendar</Link>
            </Button>
            <div className="flex flex-wrap justify-center gap-2">
              {["🔒 Read-only access", "SOC 2 Type II", "You choose every meeting"].map((t) => (
                <span
                  key={t}
                  className="rounded-pill border border-line bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-ink-3"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        }
      />
    );
  }

  // Trigger calendar sync inline (fire-and-forget) — kept from the previous
  // meetings-home so this list reflects the latest calendar state without a
  // separate sync step.
  if (conn.google_refresh_token) {
    const { buildMeetingUpsert, fetchUpcomingEvents } = await import("@/lib/calendar");
    const service = createServiceClient(); // elevated: upsert may run without request cookies in the async tail
    fetchUpcomingEvents(conn.google_refresh_token)
      .then((events) => {
        const rows = events.map((e) => buildMeetingUpsert(user.id, e));
        if (rows.length > 0) {
          service
            .from("meetings")
            .upsert(rows, { onConflict: "user_id,google_event_id", ignoreDuplicates: false })
            .then(() => {});
        }
      })
      .catch(() => {});
  }

  return (
    <Suspense key={tab} fallback={<MeetingsSkeleton />}>
      <MeetingsContent userId={user.id} tab={tab} />
    </Suspense>
  );
}

async function MeetingsContent({ userId, tab }: { userId: string; tab: MeetingsTab }) {
  try {
    const db = createServerClient();
    const now = new Date();
    const nowIso = now.toISOString();
    // A meeting is only "live" if it's in_meeting AND started recently. Bot
    // status write-backs are best-effort, so a crashed/abandoned session can
    // leave a row stuck in `in_meeting` indefinitely — without this window it
    // would show as "Happening now" for days ("128h elapsed"). 6h comfortably
    // covers real meetings while excluding stale rows.
    const LIVE_MAX_MS = 6 * 60 * 60 * 1000;
    const liveCutoffIso = new Date(now.getTime() - LIVE_MAX_MS).toISOString();
    const FIELDS = "id,title,start_time,end_time,meet_url,opted_in,bot_status,recurring_event_id,google_event_id,space_id";

    const [{ data: upcomingRows }, { data: pastRows }, { data: liveRows }, { data: spacesRows }, { data: profile }] =
      await Promise.all([
        db
          .from("meetings")
          .select(FIELDS)
          .eq("user_id", userId)
          .gte("start_time", nowIso)
          .order("start_time"),
        db
          .from("meetings")
          .select(FIELDS)
          .eq("user_id", userId)
          .lt("start_time", nowIso)
          .eq("bot_status", "done")
          .order("start_time", { ascending: false })
          .limit(40),
        // Live meetings may have started before "now", so they can't be found
        // via the upcoming/past filters above — queried separately for the
        // "Happening now" card.
        db
          .from("meetings")
          .select("id,title,start_time")
          .eq("user_id", userId)
          .eq("bot_status", "in_meeting")
          .gte("start_time", liveCutoffIso)
          .order("start_time", { ascending: false })
          .limit(1),
        db.from("spaces").select("id,name").eq("user_id", userId).eq("status", "active"),
        db.from("profiles").select("timezone").eq("user_id", userId).maybeSingle(),
      ]);

    const timeZone = (profile?.timezone as string | null) ?? "UTC";
    const spaceNameById: Record<string, string> = {};
    for (const s of spacesRows ?? []) spaceNameById[s.id as string] = s.name as string;

    const upcomingList = upcomingRows ?? [];
    const pastList = pastRows ?? [];
    const liveMeeting: LiveMeeting | null = (liveRows ?? [])[0] ?? null;

    // Attach a one-line summary + action-item count to past occurrences.
    const pastIds = pastList.map((m) => m.id as string);
    const tldrById = new Map<string, string>();
    const actionCountById: Record<string, number> = {};
    if (pastIds.length) {
      const [{ data: sums }, { data: actionRows }] = await Promise.all([
        db.from("summaries").select("meeting_id,tldr").in("meeting_id", pastIds),
        db.from("action_items").select("meeting_id").in("meeting_id", pastIds),
      ]);
      for (const s of sums ?? []) if (s.tldr) tldrById.set(s.meeting_id as string, s.tldr as string);
      for (const a of actionRows ?? []) {
        const id = a.meeting_id as string;
        actionCountById[id] = (actionCountById[id] ?? 0) + 1;
      }
    }

    const meetings = [...upcomingList, ...pastList].map((m) => ({
      ...m,
      tldr: tldrById.get(m.id as string) ?? null,
    })) as unknown as MeetingListItem[];

    const { upcoming, past } = buildHomeSections(meetings, nowIso);

    const upcomingTodayCount = upcoming.filter((row) =>
      isSameDayInTimeZone(row.meeting.start_time, now, timeZone)
    ).length;

    const dateLabel = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(now);

    return (
      <div className="mx-auto max-w-[1080px]">
        <MeetingsHeader
          dateLabel={dateLabel}
          liveCount={liveMeeting ? 1 : 0}
          upcomingTodayCount={upcomingTodayCount}
          tab={tab}
        />
        <div className="mb-5">
          <InstantJoin />
        </div>

        {tab === "upcoming" ? (
          <>
            {liveMeeting ? <LiveNowCard meeting={liveMeeting} /> : null}
            <UpcomingGroups
              rows={upcoming as unknown as (UpcomingRow & { meeting: UpcomingMeeting })[]}
              spaceNameById={spaceNameById}
              nowIso={nowIso}
              timeZone={timeZone}
            />
          </>
        ) : (
          <PastList
            meetings={past as unknown as PastMeeting[]}
            spaceNameById={spaceNameById}
            actionCountById={actionCountById}
          />
        )}
      </div>
    );
  } catch {
    return <MeetingsError />;
  }
}
