import { buildMeetingUpsert, fetchUpcomingEvents } from "@/lib/calendar";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: conn } = await service
    .from("calendar_connections")
    .select("google_refresh_token")
    .eq("user_id", user.id)
    .single();

  if (!conn) return NextResponse.json({ error: "No calendar connected" }, { status: 400 });

  const events = await fetchUpcomingEvents(conn.google_refresh_token);
  const rows = events.map((e) => buildMeetingUpsert(user.id, e));

  if (rows.length > 0) {
    await service
      .from("meetings")
      .upsert(rows, { onConflict: "user_id,google_event_id", ignoreDuplicates: false });
  }

  return NextResponse.json({ synced: rows.length });
}
