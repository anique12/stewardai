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

  if (!items.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {live ? "Transcript will appear here as the meeting proceeds." : "No transcript captured."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {items.map(({ segment, actions: attached }) => {
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
                {segment.text}
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
    </div>
  );
}
