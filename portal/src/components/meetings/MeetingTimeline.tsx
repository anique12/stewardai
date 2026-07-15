"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { buildTimeline, type Segment, type TimelineAction } from "@/lib/meetings/timeline";
import { SpeakerAvatar } from "./SpeakerAvatar";
import { ActionStepStrip } from "./ActionStepStrip";
import type { AgentAction } from "./ActionStepCard";

function clock(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase()
      ? <mark key={i} className="rounded bg-brand-weak text-ink">{p}</mark>
      : <span key={i}>{p}</span>);
}

function MeetBaseAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" fill="var(--on-brand)" />
        <path d="M6.5 6.5a7.8 7.8 0 000 11M17.5 6.5a7.8 7.8 0 010 11" stroke="var(--on-brand)" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export type SpeakerLookupEntry = { email?: string | null; photoUrl?: string | null };

export function MeetingTimeline({
  segments: initialSegments, actions: initialActions, meetingId, botName, live, speakerLookup,
}: {
  segments: Segment[]; actions: TimelineAction[]; meetingId: string; botName: string; live: boolean;
  /** Case-insensitive speaker name -> {email, photoUrl}, so transcript
   *  avatars can show a real photo when the speaker matches a known
   *  attendee. Unmatched speakers fall back to a colored initial. */
  speakerLookup?: Record<string, SpeakerLookupEntry>;
}) {
  const [segments, setSegments] = useState(initialSegments);
  const [actions, setActions] = useState(initialActions);
  const router = useRouter();

  useEffect(() => {
    if (!live) return;
    const supabase = createBrowserClient();
    let cancelled = false;
    async function poll() {
      const [{ data: segs }, { data: acts }] = await Promise.all([
        supabase.from("transcript_segments").select("*").eq("meeting_id", meetingId).order("seq"),
        supabase.from("agent_actions").select("*").eq("meeting_id", meetingId).order("created_at"),
      ]);
      if (cancelled) return;
      if (segs) setSegments(segs as Segment[]);
      if (acts) setActions(acts as TimelineAction[]);
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [live, meetingId]);

  const { items } = buildTimeline(segments, actions);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter(({ segment }) =>
        segment.text.toLowerCase().includes(q) || segment.speaker.toLowerCase().includes(q))
    : items;

  if (!items.length) {
    return (
      <p className="text-sm text-ink-3">
        {live ? "Transcript will appear here as the meeting proceeds." : "No transcript captured."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <label className="flex flex-1 items-center gap-2 rounded-md border border-line bg-surface-2 px-[11px] py-[7px] text-ink-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this transcript…"
            className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </label>
        <span className="whitespace-nowrap font-mono text-[11px] text-ink-3">
          {shown.length} line{shown.length === 1 ? "" : "s"}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-3">No lines match “{query}”.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {shown.map(({ segment, actions: attached }) => {
            const isAgent = segment.speaker.trim().toLowerCase() === botName.trim().toLowerCase();
            const match = speakerLookup?.[segment.speaker.trim().toLowerCase()];
            return (
              <div key={segment.id} className="flex gap-3 rounded-lg px-1 py-2">
                {isAgent ? (
                  <MeetBaseAvatar />
                ) : (
                  <SpeakerAvatar name={segment.speaker} email={match?.email} photoUrl={match?.photoUrl} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-semibold ${isAgent ? "text-brand" : "text-ink"}`}>
                      {segment.speaker}
                    </span>
                    {isAgent && (
                      <span className="inline-flex items-center gap-1 rounded-pill border border-brand-weak-2 bg-surface px-[7px] py-[2px] font-mono text-[9px] font-semibold uppercase tracking-[0.05em] text-brand">
                        <span className="h-[5px] w-[5px] rounded-pill bg-brand" />
                        Spoke in room
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className="font-mono text-[10.5px] text-ink-4">{clock(segment.created_at)}</span>
                  </div>
                  <p className="mt-[3px] text-sm leading-relaxed text-ink">
                    {highlight(segment.text, q)}
                  </p>
                  <ActionStepStrip
                    actions={attached as unknown as AgentAction[]}
                    meetingId={meetingId}
                    onMutate={() => router.refresh()}
                  />
                </div>
              </div>
            );
          })}

          {live && (
            <div className="flex gap-3 rounded-lg border border-dashed border-line-2 bg-surface-2 px-3.5 py-3.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand opacity-70">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3" fill="var(--on-brand)" />
                  <path d="M6.5 6.5a7.8 7.8 0 000 11M17.5 6.5a7.8 7.8 0 010 11" stroke="var(--on-brand)" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex flex-1 items-center gap-2.5">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-brand">
                  Listening
                </span>
                <span className="flex h-[14px] items-end gap-[3px]">
                  <span className="h-[6px] w-[3px] rounded-sm bg-brand anim-pulse" />
                  <span className="h-3 w-[3px] rounded-sm bg-brand anim-pulse" style={{ animationDelay: "0.2s" }} />
                  <span className="h-[9px] w-[3px] rounded-sm bg-brand anim-pulse" style={{ animationDelay: "0.4s" }} />
                  <span className="h-[14px] w-[3px] rounded-sm bg-brand anim-pulse" style={{ animationDelay: "0.6s" }} />
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
