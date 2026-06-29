import { MeetingRow } from "@/components/meetings/MeetingRow";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient();

  // Check calendar connection
  const { data: conn } = await service
    .from("calendar_connections")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!conn) {
    return (
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
    );
  }

  const now = new Date().toISOString();
  const { data: upcoming } = await service
    .from("meetings")
    .select("id,title,start_time,meet_url,opted_in,bot_status")
    .eq("user_id", user.id)
    .gte("start_time", now)
    .order("start_time");

  const { data: past } = await service
    .from("meetings")
    .select("id,title,start_time,meet_url,opted_in,bot_status")
    .eq("user_id", user.id)
    .lt("start_time", now)
    .eq("bot_status", "done")
    .order("start_time", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Upcoming</h2>
        {upcoming?.length ? (
          <div className="space-y-2">
            {upcoming.map((m) => <MeetingRow key={m.id} meeting={m} isPast={false} />)}
          </div>
        ) : (
          <p className="text-muted-foreground">No upcoming meetings in the next 3 days.</p>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Past meetings</h2>
        {past?.length ? (
          <div className="space-y-2">
            {past.map((m) => <MeetingRow key={m.id} meeting={m} isPast={true} />)}
          </div>
        ) : (
          <p className="text-muted-foreground">No completed meetings yet.</p>
        )}
      </section>
    </div>
  );
}
