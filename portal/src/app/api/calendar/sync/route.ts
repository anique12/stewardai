import { buildMeetingUpsert, fetchUpcomingEvents } from "@/lib/calendar";
import { requireUserRoute } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export async function GET() {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const db = createServerClient(); // RLS-scoped read
  const { data: conn } = await db
    .from("calendar_connections")
    .select("google_refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!conn) return NextResponse.json({ error: "No calendar connected" }, { status: 400 });

  const events = await fetchUpcomingEvents(conn.google_refresh_token);
  const rows = events.map((e) => buildMeetingUpsert(user.id, e));

  if (rows.length > 0) {
    const service = createServiceClient(); // elevated write
    // Fail soft: the row shape includes newer columns (e.g. `attendees`) that
    // may not exist until their migration runs; don't 500 the caller on a
    // transient/schema error — report how many rows we attempted.
    const { error } = await service
      .from("meetings")
      .upsert(rows, { onConflict: "user_id,google_event_id", ignoreDuplicates: false });
    if (error) {
      return NextResponse.json({ synced: 0, error: error.message }, { status: 200 });
    }
  }

  return NextResponse.json({ synced: rows.length });
}
