import { MeetingHeader } from "@/components/meetings/MeetingHeader";
import { MeetingSummary } from "@/components/meetings/MeetingSummary";
import { MeetingTimeline } from "@/components/meetings/MeetingTimeline";
import { MeetingSpaceSection } from "@/components/spaces/MeetingSpaceSection";
import type { SpaceEntity } from "@/components/spaces/SpaceEntities";
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

  const [
    { data: segments },
    { data: summary },
    { data: actionItems },
    { data: agentActions },
    { data: profile },
    { data: tagRows },
    { data: entLinks },
    { data: allSpaces },
  ] = await Promise.all([
    db.from("transcript_segments").select("*").eq("meeting_id", params.id).order("seq"),
    db.from("summaries").select("*").eq("meeting_id", params.id).maybeSingle(),
    db.from("action_items").select("*").eq("meeting_id", params.id).order("created_at"),
    db.from("agent_actions").select("*").eq("meeting_id", params.id).eq("user_id", user.id).order("created_at"),
    db.from("profiles").select("bot_name").eq("user_id", user.id).maybeSingle(),
    db.from("meeting_tags").select("tag").eq("meeting_id", params.id).eq("user_id", user.id),
    db.from("meeting_entities").select("entities(id,kind,name,email)").eq("meeting_id", params.id).eq("user_id", user.id),
    db.from("spaces").select("id,name").eq("user_id", user.id).eq("status", "active").order("name"),
  ]);

  const botName = profile?.bot_name ?? "StewardAI";

  let meetingSpace: { id: string; name: string } | null = null;
  if (meeting.space_id) {
    const { data: sp } = await db.from("spaces").select("id,name").eq("id", meeting.space_id).eq("user_id", user.id).maybeSingle();
    meetingSpace = sp ?? null;
  }
  const meetingTags = (tagRows ?? []).map((t) => t.tag as string);
  const meetingEntities = (entLinks ?? [])
    .map((row) => (row as unknown as { entities: SpaceEntity | null }).entities)
    .filter((e): e is SpaceEntity => !!e);

  return (
    <div className="flex flex-col gap-6 lg:h-full">
      <div className="shrink-0">
        <MeetingHeader
          title={meeting.title}
          startTime={meeting.start_time}
          endTime={meeting.end_time}
          meetUrl={meeting.meet_url}
          botStatus={meeting.bot_status}
        />
      </div>
      <div className="grid gap-8 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12">
        <section className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
          <div className="mb-6">
            <MeetingSpaceSection
              meetingId={params.id}
              space={meetingSpace}
              spaceSource={meeting.space_source}
              tags={meetingTags}
              entities={meetingEntities}
              allSpaces={(allSpaces ?? []) as { id: string; name: string }[]}
            />
          </div>
          <MeetingSummary
            summary={summary ?? null}
            actionItems={actionItems ?? []}
            agentActions={agentActions ?? []}
            meetingId={params.id}
          />
        </section>
        <aside className="flex min-w-0 flex-col lg:min-h-0">
          <h2 className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transcript</h2>
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
            <MeetingTimeline
              segments={segments ?? []}
              actions={agentActions ?? []}
              meetingId={params.id}
              botName={botName}
              live={meeting.bot_status === "in_meeting"}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
