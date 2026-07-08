import { notFound } from "next/navigation";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SpaceFactsPanel } from "@/components/spaces/SpaceFactsPanel";
import { SpaceEntities, type SpaceEntity } from "@/components/spaces/SpaceEntities";
import type { FactRow } from "@/lib/spaces/facts";
import { groupMeetings } from "@/lib/meetings/series";
import { SeriesCard } from "@/components/meetings/SeriesCard";
import { MeetingRow } from "@/components/meetings/MeetingRow";

export const dynamic = "force-dynamic";

export default async function SpaceDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUserPage();
  const db = createServerClient();

  const { data: space } = await db
    .from("spaces").select("id,name,kind,status")
    .eq("id", params.id).eq("user_id", user.id).single();
  if (!space) notFound();

  const [{ data: meetings }, { data: facts }] = await Promise.all([
    db.from("meetings")
      .select("id,title,start_time,meet_url,opted_in,bot_status,recurring_event_id,google_event_id")
      .eq("user_id", user.id).eq("space_id", params.id).order("start_time", { ascending: false }),
    db.from("space_facts")
      .select("id,kind,text,owner,due,status,meeting_id,source_seq,superseded_by")
      .eq("user_id", user.id).eq("space_id", params.id).order("created_at"),
  ]);

  // Entities for THIS space = entities linked to any of the space's meetings (deduped).
  // Run after meetings resolve, since we filter by their ids.
  const meetingIds = (meetings ?? []).map((m) => m.id);
  let entities: SpaceEntity[] = [];
  if (meetingIds.length > 0) {
    const { data: entLinks } = await db
      .from("meeting_entities")
      .select("entities(id,kind,name,email)")
      .eq("user_id", user.id).in("meeting_id", meetingIds);
    const byId = new Map<string, SpaceEntity>();
    for (const row of entLinks ?? []) {
      const e = (row as unknown as { entities: SpaceEntity | null }).entities;
      if (e) byId.set(e.id, e);
    }
    entities = Array.from(byId.values());
  }

  const now = new Date().toISOString();
  const entries = groupMeetings(
    (meetings ?? []).map((m) => ({ ...m, tldr: null })),
    now
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={space.name}
        subtitle={space.status === "archived" ? "Archived" : undefined}
        action={space.kind ? <Badge variant="outline">{space.kind}</Badge> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Meetings</h2>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings filed here yet.</p>
          ) : (
            entries.map((e) =>
              e.kind === "series" ? (
                <SeriesCard key={e.key} entry={e} />
              ) : (
                <MeetingRow key={e.meeting.id} meeting={e.meeting} isPast={e.meeting.start_time < now} />
              )
            )
          )}
        </div>
        <aside className="space-y-6">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">What&apos;s known</h2>
            <SpaceFactsPanel facts={(facts ?? []) as FactRow[]} />
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">People &amp; companies</h2>
            <SpaceEntities entities={entities} />
          </Card>
        </aside>
      </div>
    </div>
  );
}
