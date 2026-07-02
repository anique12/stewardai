import { InstantJoin } from "@/components/meetings/InstantJoin";
import { MeetingRow } from "@/components/meetings/MeetingRow";
import { SeriesCard } from "@/components/meetings/SeriesCard";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const user = await requireUserPage();
  const db = createServerClient(); // RLS-scoped reads

  // Check calendar connection
  const { data: conn } = await db
    .from("calendar_connections")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!conn) {
    return (
      <div className="space-y-8">
        <InstantJoin />
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <h2 className="text-xl font-semibold text-foreground">Connect your calendar</h2>
          <p className="mt-2 text-muted-foreground">
            Connect Google Calendar to see and opt in to your meetings.
          </p>
          <a href="/app/settings?connect=calendar"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Connect Calendar
          </a>
        </div>
      </div>
    );
  }

  // Trigger calendar sync inline (fire-and-forget)
  const { buildMeetingUpsert, fetchUpcomingEvents } = await import("@/lib/calendar");
  const { data: calConn } = await db
    .from("calendar_connections")
    .select("google_refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (calConn) {
    const service = createServiceClient(); // elevated: upsert may run without request cookies in the async tail
    fetchUpcomingEvents(calConn.google_refresh_token)
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

  const now = new Date().toISOString();
  const [{ data: upcomingRows }, { data: pastRows }] = await Promise.all([
    db.from("meetings")
      .select("id,title,start_time,meet_url,opted_in,bot_status,recurring_event_id,google_event_id")
      .eq("user_id", user.id)
      .gte("start_time", now)
      .order("start_time"),
    db.from("meetings")
      .select("id,title,start_time,meet_url,opted_in,bot_status,recurring_event_id,google_event_id")
      .eq("user_id", user.id)
      .lt("start_time", now)
      .eq("bot_status", "done")
      .order("start_time", { ascending: false })
      .limit(40),
  ]);

  const upcomingList = upcomingRows ?? [];
  const pastList = pastRows ?? [];

  // Attach a one-line summary to past occurrences for the series history.
  const pastIds = pastList.map((m) => m.id);
  const tldrById = new Map<string, string>();
  if (pastIds.length) {
    const { data: sums } = await db
      .from("summaries")
      .select("meeting_id,tldr")
      .in("meeting_id", pastIds);
    for (const s of sums ?? []) if (s.tldr) tldrById.set(s.meeting_id, s.tldr);
  }

  const { groupMeetings } = await import("@/lib/meetings/series");
  const meetings = [...upcomingList, ...pastList].map((m) => ({
    ...m,
    tldr: tldrById.get(m.id) ?? null,
  }));
  const entries = groupMeetings(meetings, now);

  return (
    <div className="space-y-6">
      <InstantJoin />
      {entries.length ? (
        <div className="space-y-2">
          {entries.map((e) =>
            e.kind === "series" ? (
              <SeriesCard key={e.key} entry={e} />
            ) : (
              <MeetingRow
                key={e.meeting.id}
                meeting={e.meeting}
                isPast={e.meeting.start_time < now && e.meeting.bot_status === "done"}
              />
            )
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">No upcoming or past meetings yet.</p>
      )}
    </div>
  );
}
