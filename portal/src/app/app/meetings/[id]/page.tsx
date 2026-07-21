import { LiveRefresher } from "@/components/meetings/LiveRefresher";
import { MeetingHeader } from "@/components/meetings/MeetingHeader";
import { LocalTime, MeetingMetaLine } from "@/components/meetings/LocalTime";
import { MeetingSummary } from "@/components/meetings/MeetingSummary";
import { MeetingTimeline, type SpeakerLookupEntry } from "@/components/meetings/MeetingTimeline";
import { MeetingDetailTabs } from "@/components/meetings/MeetingDetailTabs";
import { MeetingSpaceSection } from "@/components/spaces/MeetingSpaceSection";
import { OptInToggle } from "@/components/meetings/OptInToggle";
import type { SpaceEntity } from "@/components/spaces/SpaceEntities";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { meetingToMarkdown } from "@/lib/meetings/export";
import type { Attendee } from "@/lib/meetings/attendee-types";
import { notFound } from "next/navigation";
import Link from "next/link";

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

  // Best-effort, separate query: the `attendees` column may not exist yet in
  // an environment where migration 0016 hasn't been applied. Never let a
  // missing column break the whole page — fall back to no attendees.
  let attendees: Attendee[] = [];
  try {
    const { data: attendeeRow } = await db
      .from("meetings")
      .select("attendees")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .maybeSingle();
    attendees = (attendeeRow?.attendees as Attendee[] | null) ?? [];
  } catch {
    attendees = [];
  }

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

  const botName = profile?.bot_name ?? "MeetBase";

  let meetingSpace: { id: string; name: string } | null = null;
  if (meeting.space_id) {
    const { data: sp } = await db.from("spaces").select("id,name").eq("id", meeting.space_id).eq("user_id", user.id).maybeSingle();
    meetingSpace = sp ?? null;
  }
  const meetingTags = (tagRows ?? []).map((t) => t.tag as string);
  const meetingEntities = (entLinks ?? [])
    .map((row) => (row as unknown as { entities: SpaceEntity | null }).entities)
    .filter((e): e is SpaceEntity => !!e);

  // ----- Bot failed to join: no transcript will ever land for this meeting -----
  if (meeting.bot_status === "failed") {
    return (
      <div className="mx-auto max-w-[560px] px-2 py-16 text-center">
        <Link href="/app/meetings" className="mb-8 inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink">
          ← Meetings
        </Link>
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-danger-weak text-danger-strong">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="1.2" fill="currentColor" />
            <path d="M12 3l9.5 16.5H2.5L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mb-2 font-display text-xl font-bold tracking-tight text-ink">
          MeetBase couldn&apos;t join this meeting
        </h2>
        <p className="mb-1.5 text-sm leading-relaxed text-ink-2">
          The host didn&apos;t admit the bot before the meeting ended, so no transcript was captured.
        </p>
        <p className="mb-[22px] text-[12.5px] text-ink-3">
          You can still add notes manually, or point MeetBase at the recording.
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          <Link
            href="/app/meetings"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sh-1 hover:bg-brand-2"
          >
            Try instant join
          </Link>
          <Link
            href="/app/meetings"
            className="inline-flex items-center rounded-md border border-line-2 px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
          >
            Back to meetings
          </Link>
        </div>
        <div className="mt-[18px] font-mono text-[11px] text-ink-4">
          bot_not_admitted · meeting ended <LocalTime iso={meeting.end_time} />
        </div>
      </div>
    );
  }

  const hasContent = (segments?.length ?? 0) > 0 || !!summary || (actionItems?.length ?? 0) > 0;

  // ----- Bot dispatched, asking to join — NOT yet admitted -----
  // bot_status stays 'joining' until the bot is actually let into the call
  // (it flips to 'in_meeting' on first meeting audio). Show a clear "waiting to
  // be admitted" state rather than the live view, and poll so it auto-advances.
  if (!hasContent && meeting.bot_status === "joining") {
    return (
      <div className="mx-auto max-w-[720px] px-2 py-2">
        <LiveRefresher intervalMs={3000} />
        <Link href="/app/meetings" className="mb-3.5 inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink">
          ← Meetings
        </Link>
        <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{meeting.title}</h1>
          <span className="inline-flex items-center gap-[5px] rounded-pill border border-attention-weak bg-attention-weak px-2 py-[3px] font-mono text-[9.5px] font-semibold text-attention-strong">
            <span className="h-[6px] w-[6px] rounded-pill bg-current anim-pulse" />
            Waiting to be admitted
          </span>
        </div>
        <div className="mb-[26px] font-mono text-[12.5px] text-ink-3">
          <MeetingMetaLine startTime={meeting.start_time} endTime={meeting.end_time} meetUrl={meeting.meet_url} />
        </div>
        <div className="rounded-2xl border border-dashed border-line-2 bg-surface px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-attention-weak text-attention-strong">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h3 className="mb-[7px] font-display text-lg font-bold text-ink">MeetBase is asking to join</h3>
          <p className="mx-auto mb-5 max-w-[420px] text-[13.5px] leading-relaxed text-ink-2">
            MeetBase is in the meeting&apos;s lobby, waiting for a host to admit it. The named-speaker
            transcript, summary and action items will appear here live once it&apos;s let in.
          </p>
          {meeting.meet_url && (
            <div className="flex justify-center">
              <a
                href={meeting.meet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sh-1 hover:bg-brand-2"
              >
                Open meeting to admit ↗
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----- Scheduled, nothing recorded yet -----
  const notStarted = meeting.bot_status === "pending" || meeting.bot_status === "joining";
  if (!hasContent && notStarted && new Date(meeting.start_time).getTime() > Date.now()) {
    return (
      <div className="mx-auto max-w-[720px] px-2 py-2">
        {/* Auto-advance to the live view when the bot joins / content appears. */}
        <LiveRefresher />
        <Link href="/app/meetings" className="mb-3.5 inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink">
          ← Meetings
        </Link>
        <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{meeting.title}</h1>
          <span className="inline-flex items-center gap-[5px] rounded-pill border border-line bg-surface-2 px-2 py-[3px] font-mono text-[9.5px] font-semibold text-ink-4">
            <span className="h-[6px] w-[6px] rounded-pill bg-ink-4" />
            Scheduled
          </span>
        </div>
        <div className="mb-[26px] font-mono text-[12.5px] text-ink-3">
          <MeetingMetaLine startTime={meeting.start_time} endTime={meeting.end_time} meetUrl={meeting.meet_url} />
        </div>
        <div className="rounded-2xl border border-dashed border-line-2 bg-surface px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-brand-weak text-brand">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="10" width="4" height="8" rx="1.4" fill="currentColor" />
              <rect x="10" y="6" width="4" height="12" rx="1.4" fill="currentColor" />
              <rect x="16" y="12" width="4" height="6" rx="1.4" fill="currentColor" />
            </svg>
          </div>
          <h3 className="mb-[7px] font-display text-lg font-bold text-ink">Nothing recorded yet</h3>
          <p className="mx-auto mb-5 max-w-[400px] text-[13.5px] leading-relaxed text-ink-2">
            This meeting hasn&apos;t started. MeetBase will join at{" "}
            <LocalTime iso={meeting.start_time} /> and the
            named-speaker transcript, summary and action items will appear here live.
          </p>
          <div className="mb-[18px] inline-flex items-center gap-2.5 rounded-pill border border-brand-weak-2 bg-brand-weak py-2 pl-3.5 pr-2">
            <span className="text-[12.5px] font-semibold text-brand-ink">MeetBase will join this meeting</span>
            <OptInToggle meetingId={meeting.id} initialValue={meeting.opted_in} />
          </div>
          {meeting.meet_url && (
            <div className="flex justify-center">
              <a
                href={meeting.meet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sh-1 hover:bg-brand-2"
              >
                Join meeting ↗
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  const exportMarkdown = meetingToMarkdown({
    title: meeting.title,
    startTime: meeting.start_time,
    summary: (summary as unknown as import("@/lib/meetings/export").ExportSummary) ?? null,
    actionItems: (actionItems ?? []) as import("@/lib/meetings/export").ExportAction[],
  });

  const live = meeting.bot_status === "in_meeting";

  // Case-insensitive speaker name -> {email, photoUrl}, so the transcript
  // timeline can resolve a segment's `speaker` name to a known attendee and
  // show their real photo instead of a bare colored initial.
  const speakerLookup: Record<string, SpeakerLookupEntry> = {};
  for (const a of attendees) {
    if (a.name) speakerLookup[a.name.trim().toLowerCase()] = { email: a.email, photoUrl: a.photoUrl };
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Poll every server value on the page (status, summary, actions,
          approvals) while the meeting is still active. */}
      {meeting.bot_status !== "done" && meeting.bot_status !== "failed" && <LiveRefresher />}
      <MeetingHeader
        title={meeting.title}
        startTime={meeting.start_time}
        endTime={meeting.end_time}
        meetUrl={meeting.meet_url}
        botStatus={meeting.bot_status}
        markdown={exportMarkdown}
        attendees={attendees}
      />

      <div className="mt-3.5">
        <MeetingSpaceSection
          meetingId={params.id}
          space={meetingSpace}
          spaceSource={meeting.space_source}
          tags={meetingTags}
          entities={meetingEntities}
          allSpaces={(allSpaces ?? []) as { id: string; name: string }[]}
        />
      </div>

      <MeetingDetailTabs
        transcript={
          <MeetingTimeline
            segments={segments ?? []}
            actions={agentActions ?? []}
            meetingId={params.id}
            botName={botName}
            live={live}
            speakerLookup={speakerLookup}
          />
        }
        recap={
          <MeetingSummary
            summary={summary ?? null}
            actionItems={actionItems ?? []}
            agentActions={agentActions ?? []}
            meetingId={params.id}
            live={live}
          />
        }
      />
    </div>
  );
}
