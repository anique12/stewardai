"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { OptInToggle } from "./OptInToggle";
import { PlatformChip, type Platform } from "@/components/common/PlatformChip";
import { SpaceChip } from "@/components/common/SpaceChip";
import { StatusPill, type StatusPillStatus } from "@/components/common/StatusPill";
import { AttendeeAvatars } from "@/components/common/AttendeeAvatars";
import type { UpcomingRow } from "@/lib/meetings/series";

const KNOWN_STATUSES: StatusPillStatus[] = ["in_meeting", "done", "failed", "scheduled", "pending"];

function platformFromUrl(url: string | null): Platform {
  if (!url) return "No link";
  if (url.includes("zoom.us")) return "Zoom";
  if (url.includes("meet.google.com")) return "Google Meet";
  if (url.includes("teams.microsoft.com")) return "Teams";
  return "Video call";
}

function timeParts(iso: string): { time: string; ampm: string } {
  const label = new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const [time, ampm] = label.split(" ");
  return { time, ampm: ampm ?? "" };
}

function durationLabel(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function localDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function dayGroupLabel(iso: string, nowIso: string, timeZone: string): string {
  const now = new Date(nowIso);
  const key = localDateKey(new Date(iso), timeZone);
  const todayKey = localDateKey(now, timeZone);
  const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000), timeZone);
  if (key === todayKey) return "Today";
  if (key === tomorrowKey) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" }).format(
    new Date(iso)
  );
}

export type UpcomingMeeting = UpcomingRow["meeting"] & { end_time?: string | null; space_id?: string | null };

export function UpcomingGroups({
  rows,
  spaceNameById,
  nowIso,
  timeZone,
}: {
  rows: (UpcomingRow & { meeting: UpcomingMeeting })[];
  spaceNameById: Record<string, string>;
  nowIso: string;
  timeZone: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-3">No upcoming meetings.</p>;
  }

  // Rows arrive sorted ascending by start time, so grouping while preserving
  // order naturally keeps each day's rows contiguous under one heading.
  const groups: { label: string; items: typeof rows }[] = [];
  for (const row of rows) {
    const label = dayGroupLabel(row.meeting.start_time, nowIso, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(row);
    else groups.push({ label, items: [row] });
  }

  return (
    <div>
      {groups.map((group) => (
        <div key={group.label} className="mb-[22px]">
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-3">
              {group.label}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="flex flex-col gap-2.5">
            {group.items.map((row) => {
              const { meeting, seriesCount, cadence } = row;
              const isSeries = seriesCount > 1;
              const { time, ampm } = timeParts(meeting.start_time);
              const duration = durationLabel(meeting.start_time, meeting.end_time ?? null);
              const spaceName = meeting.space_id ? spaceNameById[meeting.space_id] : undefined;
              const status = KNOWN_STATUSES.includes(meeting.bot_status as StatusPillStatus)
                ? (meeting.bot_status as StatusPillStatus)
                : "scheduled";

              return (
                <div
                  key={meeting.id}
                  className="flex items-center gap-4 rounded-[13px] border border-line bg-surface px-4 py-3.5 shadow-sh-1"
                >
                  <div className="w-14 shrink-0 text-center">
                    <div className="font-mono text-[15px] font-semibold tracking-tight">{time}</div>
                    <div className="font-mono text-[10px] text-ink-3">{ampm}</div>
                  </div>
                  <div className="h-10 w-px shrink-0 bg-line" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/app/meetings/${meeting.id}`} className="truncate text-[14.5px] font-semibold hover:underline">
                        {meeting.title}
                      </Link>
                      {isSeries ? (
                        <span className="inline-flex items-center rounded-pill border border-line-2 bg-surface-2 px-[7px] py-[1px] font-mono text-[9.5px] font-semibold text-ink-3">
                          {cadence ?? "Recurring"}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
                      <PlatformChip platform={platformFromUrl(meeting.meet_url ?? null)} />
                      {duration ? (
                        <>
                          <span>·</span>
                          <span className="font-mono">{duration}</span>
                        </>
                      ) : null}
                      {spaceName ? <SpaceChip name={spaceName} /> : null}
                    </div>
                  </div>
                  <AttendeeAvatars attendees={meeting.attendees} max={3} size={22} />
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <OptInToggle meetingId={meeting.id} initialValue={meeting.opted_in} />
                    <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3">
                      {meeting.opted_in ? "Joining" : "Not joining"}
                    </span>
                  </div>
                  <StatusPill status={status} />
                  <Link
                    href={`/app/meetings/${meeting.id}`}
                    aria-label="Open meeting"
                    className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-2"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
