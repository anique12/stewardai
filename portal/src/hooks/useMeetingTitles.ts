"use client";

// Look up meeting titles + dates for a set of meeting ids (for the Sources strip
// + citation popovers). Uses the browser Supabase client, so it's RLS-scoped to
// the signed-in user. Best-effort: on any error it just returns what it has.

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export type MeetingInfo = { title: string; date: string | null };

export function useMeetingTitles(ids: string[]): Record<string, MeetingInfo> {
  // Stable key so the effect only refires when the distinct id set changes.
  const key = Array.from(new Set(ids.filter(Boolean))).sort().join(",");
  const [map, setMap] = useState<Record<string, MeetingInfo>>({});

  useEffect(() => {
    const idList = key ? key.split(",") : [];
    if (idList.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserClient();
        const { data } = await supabase
          .from("meetings")
          .select("id,title,start_time")
          .in("id", idList);
        if (cancelled || !data) return;
        const next: Record<string, MeetingInfo> = {};
        for (const m of data) {
          next[m.id as string] = {
            title: (m.title as string) || "Meeting",
            date: (m.start_time as string) ?? null,
          };
        }
        setMap(next);
      } catch {
        /* best-effort — leave the map as-is */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return map;
}
