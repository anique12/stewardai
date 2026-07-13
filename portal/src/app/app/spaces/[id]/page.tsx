import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionCard } from "@/components/common/SectionCard";
import { SpaceFactsPanel } from "@/components/spaces/SpaceFactsPanel";
import { SpaceEntities, type SpaceEntity } from "@/components/spaces/SpaceEntities";
import type { FactRow } from "@/lib/spaces/facts";
import { groupFacts } from "@/lib/spaces/facts";
import { groupMeetings } from "@/lib/meetings/series";
import { SeriesCard } from "@/components/meetings/SeriesCard";
import { MeetingRow } from "@/components/meetings/MeetingRow";

export const dynamic = "force-dynamic";

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path d="M7 7a7 7 0 000 10M17 7a7 7 0 010 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function SpaceDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUserPage();
  const db = createServerClient();

  const { data: space } = await db
    .from("spaces").select("id,name,kind,status,parent_id")
    .eq("id", params.id).eq("user_id", user.id).single();
  if (!space) notFound();

  // Breadcrumb of ancestor space names (client → project → …), bounded to a
  // sane depth since spaces can nest arbitrarily deep in principle.
  const crumbs: string[] = [];
  let parentId = space.parent_id;
  let depth = 0;
  while (parentId && depth < 5) {
    const { data: parent } = await db
      .from("spaces").select("id,name,parent_id").eq("id", parentId).eq("user_id", user.id).maybeSingle();
    if (!parent) break;
    crumbs.unshift(parent.name);
    parentId = parent.parent_id;
    depth += 1;
  }

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

  const meetingCount = meetings?.length ?? 0;
  const openCount = groupFacts((facts ?? []) as FactRow[]).action_item.length;
  const firstMeeting = (meetings ?? []).reduce<string | null>((min, m) => {
    if (!min || m.start_time < min) return m.start_time;
    return min;
  }, null);
  const sinceLabel = firstMeeting
    ? new Date(firstMeeting).toLocaleDateString([], { month: "short", year: "numeric" })
    : null;

  const nothingFiledYet = meetingCount === 0 && (facts ?? []).length === 0 && entities.length === 0;

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-3 flex items-center gap-[7px] text-xs text-ink-3">
        <Link href="/app/spaces" className="text-ink-3 hover:text-ink">Spaces</Link>
        {crumbs.map((c) => (
          <span key={c} className="flex items-center gap-[7px]">
            <ChevronIcon />
            <span className="font-medium text-ink-2">{c}</span>
          </span>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-start gap-3.5">
        <div className="min-w-0 flex-1">
          <h1 className="mb-[6px] font-display text-[26px] font-bold tracking-tight text-ink">{space.name}</h1>
          {nothingFiledYet ? null : (
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink-3">
              <span>{meetingCount} meeting{meetingCount === 1 ? "" : "s"}</span>
              {openCount > 0 ? (
                <>
                  <span>·</span>
                  <span className="text-attention">{openCount} open item{openCount === 1 ? "" : "s"}</span>
                </>
              ) : null}
              {sinceLabel ? (
                <>
                  <span>·</span>
                  <span>since {sinceLabel}</span>
                </>
              ) : null}
            </div>
          )}
        </div>
        <Link
          href="/app/chat"
          className="inline-flex items-center gap-[7px] rounded-md border border-line-2 px-3.5 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-2"
        >
          <ChatIcon />
          Ask about this space
        </Link>
      </div>

      {nothingFiledYet ? (
        <EmptyState
          className="max-w-none rounded-2xl border border-dashed border-line-2 bg-surface"
          title="Nothing filed here yet"
          body="When Steward files a meeting to this space, its facts, decisions and people will roll up here — each one sourced back to where it was said."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <div>
              <div className="mb-[13px] flex items-center gap-2">
                <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">
                  What&apos;s known
                </span>
                <span className="text-[11px] text-ink-4">every fact links to its source</span>
              </div>
              <SpaceFactsPanel facts={(facts ?? []) as FactRow[]} />
            </div>
            <div>
              <div className="mb-[11px] font-mono text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">
                Meetings filed here
              </div>
              {entries.length === 0 ? (
                <p className="text-sm text-ink-3">No meetings filed here yet.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sh-1">
                  {entries.map((e) =>
                    e.kind === "series" ? (
                      <SeriesCard key={e.key} entry={e} />
                    ) : (
                      <MeetingRow key={e.meeting.id} meeting={e.meeting} isPast={e.meeting.start_time < now} />
                    )
                  )}
                </div>
              )}
            </div>
          </div>
          <aside className="flex flex-col gap-3.5">
            {entities.length === 0 ? (
              <SectionCard label="People & companies">
                <p className="p-4 text-sm text-ink-3">No people or companies yet.</p>
              </SectionCard>
            ) : (
              <SpaceEntities entities={entities} variant="panel" />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
