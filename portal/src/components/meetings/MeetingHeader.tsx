"use client";

import { useState } from "react";
import Link from "next/link";
import { MeetingExportActions } from "./MeetingExportActions";
import { StatusPill, type StatusPillStatus } from "@/components/common/StatusPill";
import { PlatformChip, type Platform } from "@/components/common/PlatformChip";
import { AttendeeAvatars } from "@/components/common/AttendeeAvatars";
import type { Attendee } from "@/lib/meetings/attendee-types";

// "Maya, Dana, Raj +2" — first names (falls back to the email localpart),
// with any remainder folded into a "+N" suffix.
function attendeeNamesLine(attendees: Attendee[]): string | null {
  if (attendees.length === 0) return null;
  const firstNames = attendees.map((a) => (a.name || a.email).split(" ")[0]);
  const shown = firstNames.slice(0, 3);
  const overflow = firstNames.length - shown.length;
  return overflow > 0 ? `${shown.join(", ")} +${overflow}` : shown.join(", ");
}

function platformFromUrl(url: string | null): Platform {
  if (!url) return "Meeting";
  if (url.includes("zoom.us")) return "Zoom";
  if (url.includes("meet.google.com")) return "Google Meet";
  if (url.includes("teams.microsoft.com")) return "Teams";
  return "Video call";
}

function statusFromBotStatus(botStatus: string): StatusPillStatus {
  if (botStatus === "in_meeting" || botStatus === "done" || botStatus === "failed") return botStatus;
  return "pending";
}

// Elapsed time since start — good enough for a header badge that re-renders
// on navigation/poll, without wiring up a client-side ticking clock.
function elapsedLabel(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function MeetingHeader({
  title, startTime, endTime, meetUrl, botStatus, markdown, attendees,
}: {
  title: string;
  startTime: string;
  endTime: string | null;
  meetUrl: string | null;
  botStatus: string;
  markdown?: string;
  attendees?: Attendee[];
}) {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : null;
  const mins = end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)) : null;
  const isLive = botStatus === "in_meeting";
  const namesLine = attendeeNamesLine(attendees ?? []);

  // Decorative Completed/Live segmented control — only meaningful while a
  // meeting is actually live. Purely a local display preference (hides the
  // "elapsed" indicator when previewing the completed look) and never
  // affects data fetching, polling, or the real bot_status.
  const [previewCompleted, setPreviewCompleted] = useState(false);
  const showLiveCues = isLive && !previewCompleted;

  return (
    <div>
      <Link
        href="/app/meetings"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-ink-3 transition-colors hover:text-ink"
      >
        ← Meetings
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <div className="min-w-[220px] flex-1">
          <div className="mb-[7px] flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-bold leading-[1.1] tracking-tight text-ink sm:text-[25px]">
              {title}
            </h1>
            <StatusPill status={statusFromBotStatus(botStatus)} />
          </div>
          <div className="flex flex-wrap items-center gap-[9px] font-mono text-[12.5px] text-ink-3">
            <span>{start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>
            <span>·</span>
            <span>
              {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {end ? `–${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
            {mins ? (
              <>
                <span>·</span>
                <span>{mins} min</span>
              </>
            ) : null}
            <span>·</span>
            <PlatformChip platform={platformFromUrl(meetUrl)} />
            {meetUrl && (
              <a href={meetUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                Join ↗
              </a>
            )}
            {showLiveCues && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-brand">
                <span className="h-[6px] w-[6px] rounded-pill bg-brand anim-pulse" />
                {elapsedLabel(startTime)} elapsed
              </span>
            )}
          </div>
          {namesLine ? (
            <div className="mt-2 flex items-center gap-2">
              <AttendeeAvatars attendees={attendees} max={4} />
              <span className="text-[12px] text-ink-3">{namesLine}</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2.5">
          {isLive && (
            <div className="flex rounded-md border border-line bg-surface-2 p-[3px]">
              <button
                type="button"
                onClick={() => setPreviewCompleted(true)}
                className={
                  previewCompleted
                    ? "rounded px-3 py-1.5 text-[12.5px] font-semibold bg-surface text-ink shadow-sh-1"
                    : "rounded px-3 py-1.5 text-[12.5px] font-semibold text-ink-3 hover:text-ink"
                }
              >
                Completed
              </button>
              <button
                type="button"
                onClick={() => setPreviewCompleted(false)}
                className={
                  !previewCompleted
                    ? "rounded px-3 py-1.5 text-[12.5px] font-semibold bg-surface text-ink shadow-sh-1"
                    : "rounded px-3 py-1.5 text-[12.5px] font-semibold text-ink-3 hover:text-ink"
                }
              >
                Live view
              </button>
            </div>
          )}
          {markdown && (
            <MeetingExportActions
              markdown={markdown}
              filename={`${title.replace(/[^\w.-]+/g, "-").toLowerCase() || "meeting"}.md`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
