import Link from "next/link";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/common/EmptyState";
import { buildSpaceTree, type SpaceRow } from "@/lib/spaces/tree";
import { SpaceCard, type SpaceCardStats } from "@/components/spaces/SpaceCard";
import { NewSpaceDialog } from "@/components/spaces/NewSpaceDialog";

export const dynamic = "force-dynamic";

function LayersIconLg() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.5l8 4-8 4-8-4 8-4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 12l8 4 8-4M4 16.5l8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 8v5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="16.3" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function SpacesPage() {
  const user = await requireUserPage();
  const db = createServerClient();

  const [{ data: spaces }, { data: filedMeetings }, { data: facts }, { data: unfiled }] =
    await Promise.all([
      db.from("spaces").select("id,name,parent_id,kind,status").eq("user_id", user.id).eq("status", "active"),
      db.from("meetings").select("id,space_id,start_time").eq("user_id", user.id).not("space_id", "is", null),
      db.from("space_facts").select("space_id").eq("user_id", user.id).is("superseded_by", null),
      // Count only processed (done) meetings as "to review" — upcoming meetings
      // have nothing to file yet and would otherwise inflate the count forever.
      db.from("meetings").select("id").eq("user_id", user.id).eq("bot_status", "done").or("space_source.in.(suggested,unfiled),space_id.is.null"),
    ]);

  // Space stats for the grid: meeting count, open-fact count, last-updated
  // date, and up to 3 person-entity avatars per space.
  const meetingSpaceById = new Map<string, string>();
  for (const m of filedMeetings ?? []) if (m.space_id) meetingSpaceById.set(m.id, m.space_id);

  const meetingIds = Array.from(meetingSpaceById.keys());
  type EntLink = { meeting_id: string; entities: { id: string; kind: string; name: string } | null };
  let entLinks: EntLink[] = [];
  if (meetingIds.length > 0) {
    const { data } = await db
      .from("meeting_entities")
      .select("meeting_id,entities(id,kind,name)")
      .eq("user_id", user.id)
      .in("meeting_id", meetingIds);
    entLinks = (data ?? []) as unknown as EntLink[];
  }

  const statsById: Record<string, SpaceCardStats> = {};
  function stats(id: string): SpaceCardStats {
    return (statsById[id] ??= { meetings: 0, open: 0, updatedAt: null, people: [] });
  }

  for (const m of filedMeetings ?? []) {
    if (!m.space_id) continue;
    const s = stats(m.space_id);
    s.meetings += 1;
    if (!s.updatedAt || m.start_time > s.updatedAt) s.updatedAt = m.start_time;
  }
  for (const f of facts ?? []) stats(f.space_id).open += 1;

  const seenPerson = new Map<string, Set<string>>();
  for (const row of entLinks) {
    const e = row.entities;
    if (!e || e.kind !== "person") continue;
    const spaceId = meetingSpaceById.get(row.meeting_id);
    if (!spaceId) continue;
    const seen = seenPerson.get(spaceId) ?? new Set<string>();
    seenPerson.set(spaceId, seen);
    if (seen.has(e.id) || seen.size >= 3) continue;
    seen.add(e.id);
    stats(spaceId).people.push({ id: e.id, name: e.name });
  }

  const tree = buildSpaceTree((spaces ?? []) as SpaceRow[]);
  const unfiledCount = unfiled?.length ?? 0;

  return (
    <div className="space-y-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3.5 border-b border-line pb-5">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">Spaces</h1>
          <p className="mt-[3px] text-[13px] text-ink-3">
            How MeetBase organizes your work — nestable threads across every meeting
          </p>
        </div>
        <NewSpaceDialog />
      </div>

      {unfiledCount > 0 ? (
        <Link
          href="/app/spaces/unfiled"
          className="flex items-center gap-3.5 rounded-[13px] border border-attention bg-attention-weak p-3.5 transition-colors hover:brightness-95"
        >
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border border-attention bg-surface text-attention-strong">
            <ReviewIcon />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold text-ink">
              {unfiledCount} meeting{unfiledCount === 1 ? "" : "s"} need filing
            </span>
            <span className="block text-[12.5px] text-ink-2">
              MeetBase wasn&apos;t confident where these belong. Confirm or correct in a tap.
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-[6px] text-[12.5px] font-semibold text-attention-strong">
            Review
            <ChevronIcon />
          </span>
        </Link>
      ) : null}

      {tree.length === 0 ? (
        <EmptyState
          icon={<LayersIconLg />}
          title="No spaces yet"
          body="As you meet, MeetBase files each meeting into a Space — a client, a project, a topic. Have a meeting or create your first Space to start."
          action={
            <NewSpaceDialog
              trigger={
                <button
                  type="button"
                  className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-sh-1 transition-colors hover:bg-brand-2"
                >
                  Create a space
                </button>
              }
            />
          }
        />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {tree.map((node) => (
            <SpaceCard key={node.id} node={node} statsById={statsById} />
          ))}
        </div>
      )}
    </div>
  );
}
