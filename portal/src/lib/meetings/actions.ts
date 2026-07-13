export type ActionRow = {
  id: string;
  owner: string;
  task: string;
  due: string | null;
  done: boolean;
  meeting_id: string;
  meeting_title: string;
};

export function groupActionItems(rows: ActionRow[]): { open: ActionRow[]; done: ActionRow[] } {
  const open = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done);
  open.sort((a, b) => {
    if (a.due === b.due) return 0;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
  });
  return { open, done };
}

export interface ActionBuckets {
  open: {
    overdue: ActionRow[];
    today: ActionRow[];
    upcoming: ActionRow[];
    noDate: ActionRow[];
  };
  done: ActionRow[];
  stats: { open: number; overdue: number; today: number; done: number };
}

function sortByDueAsc(rows: ActionRow[]): ActionRow[] {
  return [...rows].sort((a, b) => {
    if (a.due === b.due) return 0;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
  });
}

// Calendar-day string ("YYYY-MM-DD") for a Date, as observed in `timeZone` —
// same dependency-free IANA-aware trick as lib/home.ts's localDateKey, kept
// self-contained here so this module stays pure and independently testable.
function localDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Pure bucketing of action items into overdue / today / upcoming / no-date
 * groups (open only) plus a done list and roll-up stats — the view model for
 * the Action items page's stat strip and bucketed lists. `now` is passed in
 * (rather than read internally) so classification is deterministic in tests;
 * `timeZone` decides what counts as "today" for the caller's IANA zone
 * (defaults to UTC when the caller has no user timezone on hand).
 */
export function bucketActions(rows: ActionRow[], now: Date, timeZone: string = "UTC"): ActionBuckets {
  const todayKey = localDateKey(now, timeZone);

  const openRows = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done);

  const overdue: ActionRow[] = [];
  const today: ActionRow[] = [];
  const upcoming: ActionRow[] = [];
  const noDate: ActionRow[] = [];

  for (const r of openRows) {
    if (r.due === null) {
      noDate.push(r);
    } else if (r.due < todayKey) {
      overdue.push(r);
    } else if (r.due === todayKey) {
      today.push(r);
    } else {
      upcoming.push(r);
    }
  }

  return {
    open: {
      overdue: sortByDueAsc(overdue),
      today: sortByDueAsc(today),
      upcoming: sortByDueAsc(upcoming),
      noDate,
    },
    done,
    stats: {
      open: openRows.length,
      overdue: overdue.length,
      today: today.length,
      done: done.length,
    },
  };
}
