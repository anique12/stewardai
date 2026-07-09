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
      ? <mark key={i} className="rounded bg-primary/20 text-foreground">{p}</mark>
      : <span key={i}>{p}</span>);
}

export function MeetingTimeline({
  segments: initialSegments, actions: initialActions, meetingId, botName, live,
}: {
  segments: Segment[]; actions: TimelineAction[]; meetingId: string; botName: string; live: boolean;
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

  if (!items.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {live ? "Transcript will appear here as the meeting proceeds." : "No transcript captured."}
      </p>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter(({ segment }) =>
        segment.text.toLowerCase().includes(q) || segment.speaker.toLowerCase().includes(q))
    : items;

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search transcript…"
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lines match “{query}”.</p>
      ) : (
        shown.map(({ segment, actions: attached }) => {
          const isAgent = segment.speaker.trim().toLowerCase() === botName.trim().toLowerCase();
          return (
            <div key={segment.id} className="flex gap-3">
              <SpeakerAvatar name={segment.speaker} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold ${isAgent ? "text-primary" : "text-foreground"}`}>
                    {segment.speaker}{isAgent ? " · Steward" : ""}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{clock(segment.created_at)}</span>
                </div>
                <p className={`text-sm leading-relaxed ${isAgent ? "text-foreground/90" : "text-foreground"}`}>
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
        })
      )}
    </div>
  );
}
