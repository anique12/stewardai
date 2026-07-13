import { NextResponse } from "next/server";
import { requireUserRoute } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { deriveNudges, type FailedMeeting, type OverdueAction } from "@/lib/nudges";

export async function GET() {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const db = createServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const [overdueRes, unfiledRes, failedRes] = await Promise.all([
    // action_items has no user_id column — RLS scopes it via the meetings.user_id join.
    db
      .from("action_items")
      .select("id,task,due,meetings(title)")
      .eq("done", false)
      .lt("due", today)
      .order("due", { ascending: true }),
    // Same "needs filing" query as src/app/app/spaces/unfiled/page.tsx — only
    // processed (done) meetings count as reviewable.
    db
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("bot_status", "done")
      .or("space_source.in.(suggested,unfiled),space_id.is.null"),
    db.from("meetings").select("id,title").eq("user_id", user.id).eq("bot_status", "failed"),
  ]);

  const overdueActions: OverdueAction[] = (overdueRes.data ?? []).map((r) => ({
    id: r.id as string,
    task: r.task as string,
    meetingTitle: ((r as unknown as { meetings: { title: string } | null }).meetings?.title) ?? "Meeting",
    due: r.due as string,
  }));

  const unfiledCount = unfiledRes.count ?? 0;

  const failedMeetings: FailedMeeting[] = (failedRes.data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
  }));

  const nudges = deriveNudges({ overdueActions, unfiledCount, failedMeetings });

  return NextResponse.json({ nudges });
}
