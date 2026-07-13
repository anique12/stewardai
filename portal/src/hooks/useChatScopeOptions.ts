"use client";

// Populates the Composer's scope selector: recent Spaces + Meetings the user
// can narrow a question to. Uses the browser Supabase client (RLS-scoped, same
// pattern as `useMeetingTitles`) rather than a new API route — best-effort,
// on any error it just leaves the option lists empty.

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export type SpaceOption = { id: string; name: string };
export type MeetingOption = { id: string; title: string };

export function useChatScopeOptions(): { spaces: SpaceOption[]; meetings: MeetingOption[] } {
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserClient();
        const [spacesRes, meetingsRes] = await Promise.all([
          supabase
            .from("spaces")
            .select("id,name")
            .eq("status", "active")
            .order("name")
            .limit(20),
          supabase
            .from("meetings")
            .select("id,title")
            .order("start_time", { ascending: false })
            .limit(10),
        ]);
        if (cancelled) return;
        setSpaces(
          (spacesRes.data ?? []).map((s) => ({
            id: s.id as string,
            name: (s.name as string) || "Untitled space",
          })),
        );
        setMeetings(
          (meetingsRes.data ?? []).map((m) => ({
            id: m.id as string,
            title: (m.title as string) || "Untitled meeting",
          })),
        );
      } catch {
        /* best-effort — leave the lists empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { spaces, meetings };
}
