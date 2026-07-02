# Recurring Series (Meetings Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group occurrences of a recurring calendar event into one collapsible "series" card on the meetings home (with cadence, next occurrence, and past-meeting history), while one-off meetings stay single rows.

**Architecture:** Store Google's `recurringEventId` on `meetings` (populated by both sync paths), with a read-side fallback that derives the series key from the instance `google_event_id` for pre-migration rows. Pure utils group meetings into series/single entries and infer cadence from occurrence gaps; the server-rendered home renders a `SeriesCard` per series and the existing `MeetingRow` per one-off.

**Tech Stack:** Supabase/Postgres (migration), Next.js 14 App Router + TypeScript + Jest + Tailwind (portal), Python 3.11 (sync path, pytest/ruff).

## Global Constraints

- Portal work runs from `portal/`; Python work from repo root `/Users/aniquesabir/projects/stewardai`.
- Portal tests: `npm test` (Jest, ts-jest, node env, alias `^@/(.*)$`→`src/$1`). Python: `python -m pytest <file> -v`; `ruff check <files>`.
- Series key = `recurring_event_id ?? deriveSeriesKey(google_event_id)`. A group with ≥2 occurrences is a series; 1 occurrence is a single.
- NEVER invent a series key: a `google_event_id` with no timestamp suffix → the meeting is its own key (one-off).
- Portal reads use the RLS client `createServerClient()`; the fire-and-forget sync upsert keeps the service client (auth-hardening invariant).
- Reuse existing `MeetingRow`, `OptInToggle`, `StatusBadge`; do not duplicate their logic.
- Commit after each task.

---

### Task 1: Migration — `recurring_event_id`

**Files:**
- Create: `portal/supabase/migrations/0008_meetings_recurring_event_id.sql`

**Interfaces:**
- Produces: nullable `recurring_event_id text` on `public.meetings`.

- [ ] **Step 1: Write the migration**

Create `portal/supabase/migrations/0008_meetings_recurring_event_id.sql`:

```sql
-- Groups occurrences of a recurring calendar event into one series. Populated
-- from Google's event.recurringEventId; null for one-off events (and for rows
-- written before this column existed — the portal derives a fallback key from
-- google_event_id at read time).
alter table public.meetings add column if not exists recurring_event_id text;
```

- [ ] **Step 2: Verify SQL**

Run: `grep -c "add column if not exists recurring_event_id" portal/supabase/migrations/0008_meetings_recurring_event_id.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add portal/supabase/migrations/0008_meetings_recurring_event_id.sql
git commit -m "feat(db): add recurring_event_id to meetings"
```

---

### Task 2: Populate `recurring_event_id` in both sync paths

**Files:**
- Modify: `portal/src/lib/calendar.ts` (`buildMeetingUpsert`)
- Modify: `src/stewardai/scheduler/calendar_sync.py` (the upsert row dict)
- Test: `src/stewardai/scheduler/` has tests under `tests/scheduler/` — add/extend `tests/scheduler/test_calendar_sync.py` for the Python side; the portal `buildMeetingUpsert` gets a Jest test.
- Test: `portal/src/lib/__tests__/calendar.test.ts` (exists)

**Interfaces:**
- Produces: both sync upserts write `recurring_event_id` = the event's `recurringEventId` (or null).

- [ ] **Step 1: Write the failing portal test**

Add to `portal/src/lib/__tests__/calendar.test.ts` (append; match its existing import of `buildMeetingUpsert`):

```ts
import { buildMeetingUpsert } from "@/lib/calendar";

describe("buildMeetingUpsert recurring_event_id", () => {
  it("copies recurringEventId when present", () => {
    const row = buildMeetingUpsert("u1", {
      id: "abc_20260702T140000Z",
      summary: "Sync",
      recurringEventId: "abc",
      start: { dateTime: "2026-07-02T14:00:00Z" },
      end: { dateTime: "2026-07-02T14:30:00Z" },
    } as never);
    expect(row.recurring_event_id).toBe("abc");
  });
  it("is null for a one-off event", () => {
    const row = buildMeetingUpsert("u1", {
      id: "xyz",
      summary: "One-off",
      start: { dateTime: "2026-07-02T14:00:00Z" },
      end: { dateTime: "2026-07-02T14:30:00Z" },
    } as never);
    expect(row.recurring_event_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npm test -- calendar`
Expected: FAIL — `recurring_event_id` is `undefined`, not `"abc"`/`null`.

- [ ] **Step 3: Implement the portal side**

In `portal/src/lib/calendar.ts`, add one line to the object returned by `buildMeetingUpsert`, after `meet_url`:

```ts
    meet_url: videoEntry?.uri ?? null,
    recurring_event_id: event.recurringEventId ?? null,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npm test -- calendar`
Expected: PASS.

- [ ] **Step 5: Implement the Python side**

In `src/stewardai/scheduler/calendar_sync.py`, in the upsert row dict (the block that already has `"google_event_id": e["id"]`), add:

```python
                    "google_event_id": e["id"],
                    "recurring_event_id": e.get("recurringEventId"),
```

- [ ] **Step 6: Add/adjust the Python test**

In `tests/scheduler/test_calendar_sync.py` (create if absent, matching the existing scheduler test style), assert the built row carries the id. If the module exposes the row-builder used at line ~108 (the function returning `out`), call it with a fake event `{"id": "abc_2026...", "recurringEventId": "abc", "summary": "s", "start": {"dateTime": "..."}, "end": {"dateTime": "..."}, "conferenceData": {...meet...}}` and assert `row["recurring_event_id"] == "abc"`. If that builder is not individually importable, add a minimal test that constructs the dict shape and asserts the key is set from `e.get("recurringEventId")`. Then:

Run: `python -m pytest tests/scheduler/test_calendar_sync.py -v`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
ruff check src/stewardai/scheduler/calendar_sync.py
git add portal/src/lib/calendar.ts portal/src/lib/__tests__/calendar.test.ts src/stewardai/scheduler/calendar_sync.py tests/scheduler/test_calendar_sync.py
git commit -m "feat(sync): persist recurring_event_id from Google events (portal + scheduler)"
```

---

### Task 3: `series.ts` — grouping util

**Files:**
- Create: `portal/src/lib/meetings/series.ts`
- Test: `portal/src/lib/__tests__/series.test.ts`

**Interfaces:**
- Produces:
  - `type MeetingListItem = { id: string; title: string; start_time: string; meet_url: string | null; opted_in: boolean; bot_status: string; recurring_event_id: string | null; google_event_id: string; tldr?: string | null }`.
  - `type SeriesEntry = { kind: "series"; key: string; title: string; occurrences: MeetingListItem[]; upcoming: MeetingListItem[]; past: MeetingListItem[]; nextOccurrence: MeetingListItem | null; count: number }`.
  - `type SingleEntry = { kind: "single"; meeting: MeetingListItem }`.
  - `type HomeEntry = SeriesEntry | SingleEntry`.
  - `deriveSeriesKey(googleEventId: string): string` — series id when the instance suffix looks like a Google timestamp, else the id itself.
  - `groupMeetings(meetings: MeetingListItem[], nowIso: string): HomeEntry[]`.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/__tests__/series.test.ts`:

```ts
import { deriveSeriesKey, groupMeetings, type MeetingListItem } from "@/lib/meetings/series";

const m = (over: Partial<MeetingListItem>): MeetingListItem => ({
  id: "x", title: "T", start_time: "2026-07-01T10:00:00Z", meet_url: null,
  opted_in: false, bot_status: "pending", recurring_event_id: null, google_event_id: "x", ...over,
});

describe("deriveSeriesKey", () => {
  it("strips a timestamp suffix from an instance id", () => {
    expect(deriveSeriesKey("abc123_20260702T140000Z")).toBe("abc123");
  });
  it("strips an all-day date suffix", () => {
    expect(deriveSeriesKey("abc123_20260702")).toBe("abc123");
  });
  it("returns the id unchanged when there is no timestamp suffix", () => {
    expect(deriveSeriesKey("plainid")).toBe("plainid");
    expect(deriveSeriesKey("has_underscore_but_not_ts")).toBe("has_underscore_but_not_ts");
  });
});

describe("groupMeetings", () => {
  const now = "2026-07-05T00:00:00Z";

  it("groups by stored recurring_event_id into a series with upcoming/past split", () => {
    const items = [
      m({ id: "a", recurring_event_id: "r1", start_time: "2026-07-02T10:00:00Z", bot_status: "done" }),
      m({ id: "b", recurring_event_id: "r1", start_time: "2026-07-09T10:00:00Z" }),
    ];
    const [entry] = groupMeetings(items, now);
    expect(entry.kind).toBe("series");
    const s = entry as Extract<typeof entry, { kind: "series" }>;
    expect(s.count).toBe(2);
    expect(s.past.map((x) => x.id)).toEqual(["a"]);
    expect(s.upcoming.map((x) => x.id)).toEqual(["b"]);
    expect(s.nextOccurrence?.id).toBe("b");
  });

  it("falls back to derived key for null recurring_event_id", () => {
    const items = [
      m({ id: "a", google_event_id: "r2_20260702T100000Z", start_time: "2026-07-02T10:00:00Z", bot_status: "done" }),
      m({ id: "b", google_event_id: "r2_20260709T100000Z", start_time: "2026-07-09T10:00:00Z" }),
    ];
    const [entry] = groupMeetings(items, now);
    expect(entry.kind).toBe("series");
  });

  it("treats a lone occurrence as a single entry", () => {
    const items = [m({ id: "solo", google_event_id: "solo", recurring_event_id: null })];
    const [entry] = groupMeetings(items, now);
    expect(entry.kind).toBe("single");
  });

  it("orders entries with upcoming ones (soonest first) before past-only ones", () => {
    const items = [
      m({ id: "pastonly", google_event_id: "p", start_time: "2026-07-01T10:00:00Z", bot_status: "done" }),
      m({ id: "soon", google_event_id: "s", start_time: "2026-07-06T10:00:00Z" }),
    ];
    const entries = groupMeetings(items, now);
    const firstId = entries[0].kind === "single" ? entries[0].meeting.id : entries[0].upcoming[0]?.id;
    expect(firstId).toBe("soon");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npm test -- series`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `portal/src/lib/meetings/series.ts`:

```ts
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
  for (const [key, occ] of groups) {
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npm test -- series`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/meetings/series.ts portal/src/lib/__tests__/series.test.ts
git commit -m "feat(meetings): group meetings into recurring series (with derived-key fallback)"
```

---

### Task 4: `cadence.ts` — cadence label util

**Files:**
- Create: `portal/src/lib/meetings/cadence.ts`
- Test: `portal/src/lib/__tests__/cadence.test.ts`

**Interfaces:**
- Produces: `cadenceLabel(startTimesIso: string[]): string` → "Daily" | "Weekly" | "Biweekly" | "Monthly" | "Recurring".

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/__tests__/cadence.test.ts`:

```ts
import { cadenceLabel } from "@/lib/meetings/cadence";

const daily = ["2026-07-01T10:00:00Z", "2026-07-02T10:00:00Z", "2026-07-03T10:00:00Z"];
const weekly = ["2026-07-01T10:00:00Z", "2026-07-08T10:00:00Z", "2026-07-15T10:00:00Z"];
const biweekly = ["2026-07-01T10:00:00Z", "2026-07-15T10:00:00Z", "2026-07-29T10:00:00Z"];
const monthly = ["2026-07-01T10:00:00Z", "2026-07-31T10:00:00Z", "2026-08-30T10:00:00Z"];
const irregular = ["2026-07-01T10:00:00Z", "2026-07-04T10:00:00Z", "2026-08-01T10:00:00Z"];

describe("cadenceLabel", () => {
  it("detects daily", () => expect(cadenceLabel(daily)).toBe("Daily"));
  it("detects weekly", () => expect(cadenceLabel(weekly)).toBe("Weekly"));
  it("detects biweekly", () => expect(cadenceLabel(biweekly)).toBe("Biweekly"));
  it("detects monthly", () => expect(cadenceLabel(monthly)).toBe("Monthly"));
  it("falls back to Recurring for irregular gaps", () => expect(cadenceLabel(irregular)).toBe("Recurring"));
  it("falls back to Recurring for fewer than 2 times", () => expect(cadenceLabel(["2026-07-01T10:00:00Z"])).toBe("Recurring"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npm test -- cadence`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `portal/src/lib/meetings/cadence.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

export function cadenceLabel(startTimesIso: string[]): string {
  const times = startTimesIso
    .map((t) => new Date(t).getTime())
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (times.length < 2) return "Recurring";
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY_MS);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median >= 0.5 && median <= 1.5) return "Daily";
  if (median >= 6 && median <= 8) return "Weekly";
  if (median >= 13 && median <= 15) return "Biweekly";
  if (median >= 27 && median <= 31) return "Monthly";
  return "Recurring";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npm test -- cadence`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/meetings/cadence.ts portal/src/lib/__tests__/cadence.test.ts
git commit -m "feat(meetings): infer series cadence from occurrence gaps"
```

---

### Task 5: `SeriesCard` component

**Files:**
- Create: `portal/src/components/meetings/SeriesCard.tsx`

**Interfaces:**
- Consumes: `SeriesEntry` (Task 3), `cadenceLabel` (Task 4), existing `OptInToggle`, `StatusBadge`.
- Produces: `SeriesCard({ entry }: { entry: SeriesEntry })` — collapsible; header shows title, cadence, next occurrence, count; expands to Upcoming + Past sub-lists.

- [ ] **Step 1: Implement the component**

Create `portal/src/components/meetings/SeriesCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { SeriesEntry } from "@/lib/meetings/series";
import { cadenceLabel } from "@/lib/meetings/cadence";
import { OptInToggle } from "./OptInToggle";
import { StatusBadge } from "./StatusBadge";

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SeriesCard({ entry }: { entry: SeriesEntry }) {
  const [open, setOpen] = useState(false);
  const cadence = cadenceLabel(entry.occurrences.map((o) => o.start_time));

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{entry.title}</span>
          <span className="block text-xs text-muted-foreground">
            {cadence}
            {entry.nextOccurrence
              ? ` · next ${dateLabel(entry.nextOccurrence.start_time)}`
              : " · no upcoming"}
            {` · ${entry.count} meetings`}
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-4 py-3">
          {entry.upcoming.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</h4>
              <ul className="space-y-1.5">
                {entry.upcoming.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground/90">
                      {dateLabel(o.start_time)} · {timeLabel(o.start_time)}
                    </span>
                    <OptInToggle meetingId={o.id} initialValue={o.opted_in} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {entry.past.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Past</h4>
              <ul className="space-y-2">
                {entry.past.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground/90">{dateLabel(o.start_time)}</p>
                      {o.tldr ? <p className="truncate text-xs text-muted-foreground">{o.tldr}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={o.bot_status} />
                      <Link href={`/app/meetings/${o.id}`} className="text-sm text-primary hover:underline">View</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/meetings/SeriesCard.tsx
git commit -m "feat(meetings): collapsible SeriesCard (cadence, next, occurrences, history)"
```

---

### Task 6: Wire the home page to series grouping

**Files:**
- Modify: `portal/src/app/app/page.tsx`

**Interfaces:**
- Consumes: `groupMeetings` + `MeetingListItem` (Task 3), `SeriesCard` (Task 5), existing `MeetingRow`, `InstantJoin`.
- Produces: series-aware home list.

**Change summary:** Keep the guard, the connect-calendar empty state, and the fire-and-forget sync exactly as they are. Replace the two flat Upcoming/Past queries + render with: one query for all the user's relevant meetings (upcoming + recent past done), selecting the new column and `google_event_id`; a `tldr` lookup for the past ones merged in; then `groupMeetings` + render each entry.

- [ ] **Step 1: Replace the queries**

In `portal/src/app/app/page.tsx`, replace the `const now = ...` block and both `upcoming`/`past` queries (lines ~60–75) with:

```tsx
  const now = new Date().toISOString();
  const [{ data: upcomingRows }, { data: pastRows }] = await Promise.all([
    db.from("meetings")
      .select("id,title,start_time,meet_url,opted_in,bot_status,recurring_event_id,google_event_id")
      .eq("user_id", user.id)
      .gte("start_time", now)
      .order("start_time"),
    db.from("meetings")
      .select("id,title,start_time,meet_url,opted_in,bot_status,recurring_event_id,google_event_id")
      .eq("user_id", user.id)
      .lt("start_time", now)
      .eq("bot_status", "done")
      .order("start_time", { ascending: false })
      .limit(40),
  ]);

  const upcomingList = upcomingRows ?? [];
  const pastList = pastRows ?? [];

  // Attach a one-line summary to past occurrences for the series history.
  const pastIds = pastList.map((m) => m.id);
  const tldrById = new Map<string, string>();
  if (pastIds.length) {
    const { data: sums } = await db
      .from("summaries")
      .select("meeting_id,tldr")
      .in("meeting_id", pastIds);
    for (const s of sums ?? []) if (s.tldr) tldrById.set(s.meeting_id, s.tldr);
  }

  const { groupMeetings } = await import("@/lib/meetings/series");
  const meetings = [...upcomingList, ...pastList].map((m) => ({
    ...m,
    tldr: tldrById.get(m.id) ?? null,
  }));
  const entries = groupMeetings(meetings, now);
```

- [ ] **Step 2: Replace the render**

Replace the `return (...)` block's two `<section>`s (Upcoming/Past) with a single series-aware list, and add the imports at the top (`SeriesCard`; keep `MeetingRow`, `InstantJoin`):

```tsx
  return (
    <div className="space-y-6">
      <InstantJoin />
      {entries.length ? (
        <div className="space-y-2">
          {entries.map((e) =>
            e.kind === "series" ? (
              <SeriesCard key={e.key} entry={e} />
            ) : (
              <MeetingRow
                key={e.meeting.id}
                meeting={e.meeting}
                isPast={e.meeting.start_time < now && e.meeting.bot_status === "done"}
              />
            )
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">No upcoming or past meetings yet.</p>
      )}
    </div>
  );
```

Add to the imports at the top of the file:

```tsx
import { SeriesCard } from "@/components/meetings/SeriesCard";
```

- [ ] **Step 3: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: zero errors. (`MeetingRow`'s `meeting` prop type accepts the selected fields; the extra `recurring_event_id`/`google_event_id`/`tldr` are ignored by it.)

- [ ] **Step 4: Commit**

```bash
git add portal/src/app/app/page.tsx
git commit -m "feat(meetings): render meetings home as recurring series + one-off rows"
```

---

### Task 7: Final verification

- [ ] **Step 1: Portal tests + build**

Run: `cd portal && npm test && npm run build`
Expected: all Jest suites pass; `next build` compiles with no lint/type errors. **Stop the dev server first** if running (concurrent `.next` writes cause spurious `PageNotFoundError`).

- [ ] **Step 2: Python test + lint**

Run: `python -m pytest tests/scheduler/test_calendar_sync.py -v && ruff check src/stewardai/scheduler/calendar_sync.py`
Expected: pass; ruff clean.

- [ ] **Step 3: Apply migration + manual check**

Apply `0008_meetings_recurring_event_id.sql` to Supabase. Then, against a running dev server, on `/app`:
- A recurring event shows as one series card with the right cadence / next occurrence / count; expanding lists occurrences in order with opt-in (upcoming) and status + summary + View (past).
- A one-off meeting still renders as a single row.
- A pre-migration recurring meeting (null `recurring_event_id`) still groups via the derived-key fallback.

- [ ] **Step 4: Commit any fixups** (only if needed)

```bash
git add -A portal src && git commit -m "chore(meetings): recurring-series verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §3.1 store `recurring_event_id` + derive fallback → Tasks 1, 2, 3 (`deriveSeriesKey`). ✅
- §3.2 `groupMeetings` grouping/split/ordering → Task 3. ✅
- §3.3 cadence util → Task 4. ✅
- §3.4 home UI (series cards + one-offs, tldr snippet, opt-in, links) → Tasks 5, 6. ✅
- §4 empty/missing-tldr/no-upcoming states → Task 5 (conditionals) + Task 6 (empty copy). ✅
- §5 testing → per-task tests + Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step has real code and commands. ✅

**Type consistency:** `MeetingListItem`, `SeriesEntry`, `SingleEntry`, `HomeEntry`, `deriveSeriesKey`, `groupMeetings` (Task 3) are consumed unchanged by `SeriesCard` (Task 5) and the home page (Task 6); `cadenceLabel` (Task 4) signature matches its callers. ✅

**Scope honesty:** No backfill of historical `recurring_event_id` (derived-key fallback covers reads); per-series bulk settings and RRULE-exact cadence are out of scope.
