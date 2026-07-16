import type { ActionRow } from "@/lib/meetings/actions";

export type HomeMeetingRow = {
  id: string;
  title: string;
  start_time: string;
  bot_status: string;
  meet_url: string | null;
};

// Extends the shared ActionRow (used by the Actions page + list) with the
// space name, so the Needs-action card can show "<meeting> · <space>".
export type HomeActionRow = ActionRow & { space_name: string | null };

export type HomeRecapRow = {
  meeting_id: string;
  title: string;
  start_time: string;
  tldr: string;
  space_name: string | null;
};

export type HomeSpaceRow = {
  id: string;
  name: string;
  open: number;
};

export interface HomeDataInput {
  meetings: HomeMeetingRow[];
  actions: HomeActionRow[];
  recaps: HomeRecapRow[];
  spaces: HomeSpaceRow[];
  unfiledCount: number;
}

export interface HomeData {
  meetingsToday: number;
  openActions: number;
  agenda: HomeMeetingRow[];
  recaps: HomeRecapRow[];
  needsAction: HomeActionRow[];
  reviewCount: number;
  spacesPulse: HomeSpaceRow[];
}

const NEEDS_ACTION_LIMIT = 5;
const RECAPS_LIMIT = 5;
const SPACES_PULSE_LIMIT = 5;

// Calendar-day string ("YYYY-MM-DD") for a Date, as observed in `timeZone`.
// Dependency-free IANA-aware formatting: en-CA gives ISO-ordered digits.
function localDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function isSameDayInTimeZone(iso: string, now: Date, timeZone: string): boolean {
  return localDateKey(new Date(iso), timeZone) === localDateKey(now, timeZone);
}

// Time-of-day for the agenda row ("9:00" + "AM"), rendered in the user's
// timezone. These home components render on the SERVER, so an unqualified
// toLocaleTimeString would format in the server's zone (UTC on Vercel) — the
// timezone MUST be passed explicitly. See the meeting detail header, which is
// a client component and formats in the browser's zone for free.
export function agendaTimeParts(iso: string, timeZone: string): { time: string; ampm: string } {
  const label = new Date(iso).toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const [time, ampm] = label.split(" ");
  return { time, ampm: ampm ?? "" };
}

// Short calendar date for a recap ("Jul 16"), in the user's timezone — same
// server-rendering caveat as agendaTimeParts: without timeZone a late-evening
// meeting can render on the wrong day.
export function recapDateLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" });
}

// Ascending by due date, with undated items pushed to the end — same ordering
// as groupActionItems() in lib/meetings/actions.ts, but kept generic here so
// callers don't lose the space_name field to that function's ActionRow[] type.
function sortByDueAsc<T extends { due: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.due === b.due) return 0;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
  });
}

/**
 * Pure assembly of the Home dashboard's derived view model from already-fetched
 * rows. `now` is passed in (rather than read internally) so date-based
 * filtering — "today's agenda" — is deterministic in tests. `timeZone` is the
 * user's IANA timezone (e.g. "America/New_York"); "today" is decided in that
 * timezone, not the server's local time, so evening meetings don't drop out
 * of / wrongly appear in the agenda for non-UTC users on a UTC server.
 */
export function buildHomeData(input: HomeDataInput, now: Date, timeZone: string): HomeData {
  const agenda = input.meetings
    .filter((m) => isSameDayInTimeZone(m.start_time, now, timeZone))
    .sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0));

  const openActions = input.actions.filter((a) => !a.done);
  const needsAction = sortByDueAsc(openActions).slice(0, NEEDS_ACTION_LIMIT);

  const recaps = input.recaps
    .filter((r) => r.tldr)
    .sort((a, b) => (a.start_time < b.start_time ? 1 : a.start_time > b.start_time ? -1 : 0))
    .slice(0, RECAPS_LIMIT);

  const spacesPulse = [...input.spaces]
    .sort((a, b) => b.open - a.open)
    .slice(0, SPACES_PULSE_LIMIT);

  return {
    meetingsToday: agenda.length,
    openActions: openActions.length,
    agenda,
    recaps,
    needsAction,
    reviewCount: input.unfiledCount,
    spacesPulse,
  };
}
