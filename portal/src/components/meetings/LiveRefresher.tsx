"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the meeting detail page's server render on a short interval so EVERY
 * server-fetched value on the page (bot status, summary, action items, agent
 * actions / approvals, space) updates live during a meeting without a manual
 * refresh. Mounted only while the meeting is non-terminal; unmounts (and stops
 * polling) once the meeting is done/failed.
 *
 * The transcript has its own finer-grained 2s poll in MeetingTimeline; this is
 * the page-wide refresh for everything else.
 */
export function LiveRefresher({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
