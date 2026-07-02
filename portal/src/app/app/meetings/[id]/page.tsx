import { MeetingHeader } from "@/components/meetings/MeetingHeader";
import { MeetingSummary } from "@/components/meetings/MeetingSummary";
import { MeetingTimeline } from "@/components/meetings/MeetingTimeline";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUserPage();
  const db = createServerClient(); // RLS-scoped reads

  const { data: meeting } = await db
    .from("meetings")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!meeting) notFound();

  const [{ data: segments }, { data: summary }, { data: actionItems }, { data: agentActions }, { data: profile }] =
    await Promise.all([
      db.from("transcript_segments").select("*").eq("meeting_id", params.id).order("seq"),
      db.from("summaries").select("*").eq("meeting_id", params.id).maybeSingle(),
      db.from("action_items").select("*").eq("meeting_id", params.id).order("created_at"),
      db.from("agent_actions").select("*").eq("meeting_id", params.id).eq("user_id", user.id).order("created_at"),
      db.from("profiles").select("bot_name").eq("user_id", user.id).maybeSingle(),
    ]);

  const botName = profile?.bot_name ?? "StewardAI";

  return (
    <div className="space-y-6">
      <MeetingHeader
        title={meeting.title}
        startTime={meeting.start_time}
        endTime={meeting.end_time}
        meetUrl={meeting.meet_url}
        botStatus={meeting.bot_status}
      />
      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <MeetingSummary
            summary={summary ?? null}
            actionItems={actionItems ?? []}
            agentActions={agentActions ?? []}
            meetingId={params.id}
          />
        </aside>
        <section className="min-w-0">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h2>
          <MeetingTimeline
            segments={segments ?? []}
            actions={agentActions ?? []}
            meetingId={params.id}
            botName={botName}
            live={meeting.bot_status === "in_meeting"}
          />
        </section>
      </div>
    </div>
  );
}
