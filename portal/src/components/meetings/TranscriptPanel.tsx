"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

type Segment = { id: string; seq: number; speaker: string; text: string };

/**
 * Shows the transcript. Each finalized utterance is written to Supabase live by
 * the agent, but a server-rendered page is a one-time snapshot — so while the
 * meeting is in progress we poll every few seconds and refresh, otherwise the
 * transcript looks "stuck" until a manual reload. Once the meeting is done we
 * render the final snapshot with no polling.
 */
export function TranscriptPanel({
  segments: initial,
  meetingId,
  live = false,
}: {
  segments: Segment[];
  meetingId: string;
  live?: boolean;
}) {
  const [segments, setSegments] = useState<Segment[]>(initial);

  useEffect(() => {
    if (!live) return;
    const supabase = createBrowserClient();
    let cancelled = false;
    async function poll() {
      const { data } = await supabase
        .from("transcript_segments")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("seq");
      if (!cancelled && data) setSegments(data as Segment[]);
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live, meetingId]);

  if (!segments.length) {
    return (
      <p className="text-muted-foreground">
        Transcript will appear here once the meeting starts.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {segments.map((s) => (
        <div key={s.id} className="flex gap-3">
          <span className="w-24 shrink-0 text-sm font-medium text-primary">{s.speaker}</span>
          <p className="text-foreground">{s.text}</p>
        </div>
      ))}
    </div>
  );
}
