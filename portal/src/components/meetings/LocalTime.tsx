"use client";

/**
 * Meeting date/time rendered in the VIEWER's timezone.
 *
 * The meeting detail page (`app/app/meetings/[id]/page.tsx`) is an async SERVER
 * component, so any `toLocaleTimeString`/`toLocaleDateString` called in it formats in
 * the SERVER's timezone (UTC on Vercel) — which is why its scheduled/empty states
 * showed the wrong time while the `app/meetings` list (rendered inside the client
 * `UpcomingGroups`) showed the correct local time. Formatting inside these client
 * components moves it back to the browser's timezone, matching the list and
 * `MeetingHeader`. `suppressHydrationWarning` silences the expected server(UTC) →
 * client(local) text difference during hydration.
 */

function platformLabel(meetUrl: string | null): string | null {
  if (!meetUrl) return null;
  if (meetUrl.includes("zoom.us")) return "Zoom";
  if (meetUrl.includes("meet.google.com")) return "Google Meet";
  if (meetUrl.includes("teams.microsoft.com")) return "Teams";
  return null;
}

export function LocalTime({ iso }: { iso: string }) {
  return (
    <span suppressHydrationWarning>
      {new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

export function MeetingMetaLine({
  startTime,
  endTime,
  meetUrl,
}: {
  startTime: string;
  endTime: string | null;
  meetUrl: string | null;
}) {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : null;
  const mins = end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)) : null;
  const parts = [
    start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  ];
  if (mins) parts.push(`${mins} min`);
  const platform = platformLabel(meetUrl);
  if (platform) parts.push(platform);
  return <span suppressHydrationWarning>{parts.join(" · ")}</span>;
}
