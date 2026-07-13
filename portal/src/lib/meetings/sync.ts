import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMeetingUpsert, fetchUpcomingEvents } from "@/lib/calendar";
import { defaultOptedIn, type AutoJoinPolicy } from "@/lib/meetings/auto-join";

const DEFAULT_POLICY: AutoJoinPolicy = "all";

/**
 * Fire-and-forget calendar sync shared by the dashboard and meetings pages.
 *
 * Applies the user's `auto_join_policy` as the DEFAULT `opted_in` for
 * NEWLY-synced meetings only. Meetings that already exist are re-upserted
 * WITHOUT `opted_in` so a user's manual per-meeting toggle survives re-sync
 * (this is the fix for the previous clobber-on-every-sync bug).
 */
export async function syncUserMeetings(
  service: SupabaseClient,
  userId: string,
  refreshToken: string
): Promise<void> {
  const [events, { data: profile }, { data: existingRows }] = await Promise.all([
    fetchUpcomingEvents(refreshToken),
    service.from("profiles").select("auto_join_policy").eq("user_id", userId).maybeSingle(),
    service.from("meetings").select("google_event_id").eq("user_id", userId),
  ]);

  if (events.length === 0) return;

  const policy = ((profile?.auto_join_policy as string | null) ?? DEFAULT_POLICY) as AutoJoinPolicy;
  const existingIds = new Set((existingRows ?? []).map((r) => r.google_event_id as string));

  const newRows: Array<ReturnType<typeof buildMeetingUpsert> & { opted_in: boolean }> = [];
  const existingRowsToUpsert: Array<ReturnType<typeof buildMeetingUpsert>> = [];

  for (const event of events) {
    const base = buildMeetingUpsert(userId, event);
    if (existingIds.has(base.google_event_id)) {
      existingRowsToUpsert.push(base);
    } else {
      const isOrganizer = Boolean(event.organizer?.self);
      const hasMeetUrl = Boolean(base.meet_url);
      newRows.push({ ...base, opted_in: defaultOptedIn(policy, { isOrganizer, hasMeetUrl }) });
    }
  }

  const upserts: Promise<unknown>[] = [];
  if (newRows.length > 0) {
    upserts.push(
      Promise.resolve(
        service.from("meetings").upsert(newRows, { onConflict: "user_id,google_event_id", ignoreDuplicates: false })
      )
    );
  }
  if (existingRowsToUpsert.length > 0) {
    upserts.push(
      Promise.resolve(
        service
          .from("meetings")
          .upsert(existingRowsToUpsert, { onConflict: "user_id,google_event_id", ignoreDuplicates: false })
      )
    );
  }
  await Promise.all(upserts);
}
