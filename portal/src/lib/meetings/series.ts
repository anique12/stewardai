export type MeetingListItem = {
  id: string;
  title: string;
  start_time: string;
  meet_url: string | null;
  opted_in: boolean;
  bot_status: string;
  recurring_event_id: string | null;
  google_event_id: string;
  tldr?: string | null;
};

export type SeriesEntry = {
  kind: "series";
  key: string;
  title: string;
  occurrences: MeetingListItem[];
  upcoming: MeetingListItem[];
  past: MeetingListItem[];
  nextOccurrence: MeetingListItem | null;
  count: number;
};
export type SingleEntry = { kind: "single"; meeting: MeetingListItem };
export type HomeEntry = SeriesEntry | SingleEntry;

// Google recurring-instance ids look like "<seriesId>_<YYYYMMDD>T<HHMMSS>Z" or
// "<seriesId>_<YYYYMMDD>" (all-day). Only strip the suffix when it matches that
// shape; otherwise the id is its own key (a genuine one-off).
const INSTANCE_SUFFIX = /_(\d{8}(T\d{6}Z)?)$/;

export function deriveSeriesKey(googleEventId: string): string {
  const match = INSTANCE_SUFFIX.exec(googleEventId);
  return match ? googleEventId.slice(0, match.index) : googleEventId;
}

function seriesKey(m: MeetingListItem): string {
  return m.recurring_event_id ?? deriveSeriesKey(m.google_event_id);
}

export function groupMeetings(meetings: MeetingListItem[], nowIso: string): HomeEntry[] {
  const groups = new Map<string, MeetingListItem[]>();
  for (const meeting of meetings) {
    const key = seriesKey(meeting);
    const arr = groups.get(key);
    if (arr) arr.push(meeting);
    else groups.set(key, [meeting]);
  }

  const entries: HomeEntry[] = [];
  for (const [key, occ] of Array.from(groups.entries())) {
    if (occ.length < 2) {
      entries.push({ kind: "single", meeting: occ[0] });
      continue;
    }
    const upcoming = occ
      .filter((o) => o.start_time >= nowIso)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const past = occ
      .filter((o) => o.start_time < nowIso)
      .sort((a, b) => b.start_time.localeCompare(a.start_time));
    const title = (past[0] ?? upcoming[0] ?? occ[0]).title;
    entries.push({
      kind: "series",
      key,
      title,
      occurrences: occ,
      upcoming,
      past,
      nextOccurrence: upcoming[0] ?? null,
      count: occ.length,
    });
  }

  const hasUpcoming = (e: HomeEntry): boolean =>
    e.kind === "series" ? e.upcoming.length > 0 : e.meeting.start_time >= nowIso;

  return entries.sort((a, b) => {
    const au = hasUpcoming(a);
    const bu = hasUpcoming(b);
    if (au !== bu) return au ? -1 : 1; // upcoming entries first
    const at = a.kind === "series"
      ? new Date((au ? a.nextOccurrence! : a.past[0]).start_time).getTime()
      : new Date(a.meeting.start_time).getTime();
    const bt = b.kind === "series"
      ? new Date((bu ? b.nextOccurrence! : b.past[0]).start_time).getTime()
      : new Date(b.meeting.start_time).getTime();
    return au ? at - bt : bt - at; // upcoming ascending; past-only descending
  });
}
