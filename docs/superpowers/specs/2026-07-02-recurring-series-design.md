# Meeting Intelligence — Recurring Series on the Meetings Home

**Date:** 2026-07-02
**Status:** Approved design → implementation
**Parent spec:** `2026-07-02-production-mvp-requirements.md` (§2.1 information architecture, §2.3 data sources)
**Scope:** Full-stack — Supabase migration, both calendar-sync paths (portal `src/lib/calendar.ts` + Python `src/stewardai/scheduler/calendar_sync.py`), and the meetings-home page (`portal/src/app/app/page.tsx`).

---

## 1. Goal

Group occurrences of a recurring calendar event into a single **series** on the meetings home, shown as a collapsible card with its cadence, next occurrence, and history of past meetings (each with a one-line summary and a link), while one-off meetings remain single rows. Finishes the deferred piece of Meeting Intelligence (§2.1).

## 2. Current state

- `portal/src/app/app/page.tsx` renders two flat lists — **Upcoming** (future) and **Past** (`bot_status = 'done'`) — of `MeetingRow`, after triggering a fire-and-forget calendar sync.
- Both sync paths call Google Calendar with **`singleEvents: true`**, expanding recurring events into instances. Each instance carries **`recurringEventId`** (the master event's id); the RRULE/`recurrence` is *not* returned in this mode.
- `meetings` has `google_event_id` (unique per `user_id`), `title`, `start_time`, `end_time`, `bot_status`, `opted_in`, `meet_url`. There is **no** recurring-event id column today.
- `summaries.tldr` holds a per-meeting summary.

## 3. Design

### 3.1 Series key — store `recurring_event_id`, derive as fallback

- **Migration `0008_meetings_recurring_event_id.sql`**: `alter table public.meetings add column if not exists recurring_event_id text;` (nullable; no RLS change).
- **Populate in both sync paths** from the Google event's `recurringEventId` (null for one-off events):
  - Portal `buildMeetingUpsert` (`src/lib/calendar.ts`): add `recurring_event_id: event.recurringEventId ?? null`.
  - Python `calendar_sync.py` upsert row: add `"recurring_event_id": e.get("recurringEventId")`.
- **Fallback for pre-migration rows** (pure util, read side): if `recurring_event_id` is null, derive a series key from `google_event_id`. Google instance ids look like `<seriesId>_<YYYYMMDD>T<HHMMSS>Z` (or `..._<YYYYMMDD>` for all-day). If the substring after the last `_` matches that timestamp shape, the series key is the part before it; otherwise the meeting is a one-off (key = its own id). This groups historical meetings with no backfill.

### 3.2 Grouping (pure util `lib/meetings/series.ts`)

`groupMeetings(meetings: MeetingListItem[], now: string): HomeEntry[]` where:

- `MeetingListItem = { id, title, start_time, meet_url, opted_in, bot_status, recurring_event_id: string | null, google_event_id, tldr?: string | null }`.
- `seriesKey(m)` = `m.recurring_event_id ?? deriveSeriesKey(m.google_event_id)`.
- Group by `seriesKey`. A group with **≥2** occurrences becomes a `SeriesEntry`; a group with **1** becomes a `SingleEntry`.
- `SeriesEntry = { kind: "series"; key; title; occurrences: MeetingListItem[]; upcoming: MeetingListItem[]; past: MeetingListItem[]; nextOccurrence: MeetingListItem | null; count }`. `title` = the most recent occurrence's title. `upcoming` = `start_time >= now` sorted ascending; `past` = `start_time < now` sorted descending; `nextOccurrence` = first upcoming.
- `SingleEntry = { kind: "single"; meeting: MeetingListItem }`.
- Return entries sorted by a **sort key**: the series/meeting's `nextOccurrence.start_time` if any upcoming exists (ascending, soonest first), otherwise the most recent past `start_time` (descending) placed after all entries that have upcoming occurrences.

### 3.3 Cadence (pure util `lib/meetings/cadence.ts`)

`cadenceLabel(startTimesIso: string[]): string` — sort times, take the **median gap** in days between consecutive occurrences: `≈1 → "Daily"`, `6–8 → "Weekly"`, `13–15 → "Biweekly"`, `27–31 → "Monthly"`, anything else or `<2` occurrences → `"Recurring"`.

### 3.4 Home UI

`page.tsx` (server, RLS reads) fetches the user's meetings (a bounded window: all upcoming + recent past, e.g. `bot_status='done'` past limited to 40) with the new column, plus `tldr` for the past ones (a second RLS query `summaries.select(meeting_id,tldr).in(meeting_id, pastIds)`, merged in). It calls `groupMeetings` and renders each entry:

- **`SingleEntry`** → the existing `MeetingRow` (unchanged).
- **`SeriesEntry`** → a new `SeriesCard` (client, collapsible):
  - Collapsed header: title, a cadence badge (`cadenceLabel`), "next {date}" (or "no upcoming"), and "{count} meetings". Chevron toggles.
  - Expanded: an **Upcoming** sub-list (each occurrence: date/time + `OptInToggle`) and a **Past** sub-list (each: date + `StatusBadge` + a one-line `tldr` snippet when present + a "View" link to `/app/meetings/{id}`), in chronological order.

The "connect calendar" empty state and the fire-and-forget sync trigger are unchanged. If a user has only one-offs, the page looks as it does today.

## 4. Error / empty / loading states

- No meetings after sync → existing empty copy ("No upcoming meetings…", "No completed meetings yet.") preserved, phrased for the unified list.
- A series with no upcoming → header shows "no upcoming"; only the Past sub-list renders.
- Missing `tldr` → the past occurrence shows date + status only.
- Coherent light + dark via existing CSS variables; small, dense typography consistent with the rest of the app.

## 5. Testing

- **Unit (Jest):** `deriveSeriesKey` (instance-id split, all-day suffix, non-recurring id → self), `groupMeetings` (stored key groups; derived-key fallback groups; single occurrence → SingleEntry; upcoming/past split + ordering; entry sort order), `cadenceLabel` (daily/weekly/biweekly/monthly, irregular and <2 → "Recurring").
- **Manual:** after applying the migration and a calendar sync, a recurring event collapses into one series card with correct cadence/next/count, expands to ordered occurrences with past summaries and working links/opt-in; a one-off still renders as a single row; a pre-migration recurring meeting still groups via the derived-key fallback.
- `npm test` + `next build` + `ruff`/`pytest` for the Python sync edit green.

## 6. Out of scope

- Backfilling `recurring_event_id` for historical rows (the derived-key fallback covers reads).
- Per-series settings (opt-in-all, mute) beyond the existing per-occurrence opt-in toggle.
- RRULE-based exact cadence (inferred from gaps is sufficient without the master event).
- Changes to the per-meeting detail page (done in the prior slice).
