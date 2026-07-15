# Dedup-per-Meeting + Fan-Out — Design Spec

**Date:** 2026-07-15
**Status:** Approved (design), pending user review of this document
**Product:** MeetBase

## Problem

Today the scheduler dispatches one Vexa bot per `meetings` row. `meetings` is
keyed per user (`unique (user_id, google_event_id)`), so when **N MeetBase
users are invited to the same Google Meet**, N separate rows come due for the
same `native_meeting_id` and the scheduler tries to spawn **N bots into the
same call**. Two failures follow:

1. MeetBase uses a **single shared authenticated Google account**. That account
   cannot be in two calls at once, nor the same call twice — so the extra
   dispatches collide or fail.
2. Even when one bot does join, the multiplexer resolves **exactly one**
   `user_id` per `native_meeting_id` (`_resolve_user_id`), so only that one user
   gets a transcript, summary, action items, and emails. The other invited
   MeetBase users get nothing.

## Goal

When several opted-in MeetBase users share the same `native_meeting_id`:

- Join **one** bot for that call (dedup).
- **Fan out** the results — transcript, summary, action items, and post-meeting
  emails — to **every** opted-in MeetBase user in that call.
- Improve join reliability against Google's March 2026 "potential risk"
  default-deny of third-party bots.

## Research basis (why this shape)

- **Otter's "Notetaker Deduplication"** is the proven pattern for a bot
  architecture: only one notetaker joins per meeting per workspace; the chosen
  driver is the member connected to the most participants; notes are then shared.
  MeetBase's case is simpler — no workspaces, one shared bot account — so the
  dedup boundary is naturally "all opted-in MeetBase users in the same call."
- **Recall.ai's docs** (the infra behind many notetakers) confirm the join
  mechanics: authenticated bots show the **Google account's** display name
  (`bot_name` is ignored) and **skip the waiting room when the bot's email is on
  the calendar invite**; authenticated concurrency is solved with a pool of
  logins ("login groups", round-robined).
- **Google (March 2026)** now flags third-party notetaker bots as "potential
  risk" and defaults to denying entry. Guest/unauthenticated joins are therefore
  getting *less* reliable, not more. Staying authenticated **and** putting the
  bot on the invite is the most reliable path available.

## Scope

**In scope:** same-meeting dedup + fan-out; the "bot on the invite" reliability
step for organizer-owned events.

**Out of scope (separate future spec):** cross-meeting concurrency via a pool of
bot accounts (Recall's "login group" model). One authenticated account still
serves one call at a time; overlapping *different* meetings remain a known
limitation until the pool spec lands.

## Chosen approach: fan-out at write time, keep per-user rows

Rejected alternatives:
- **Canonical meeting + `meeting_members` table** — cleaner long-term but forces
  a large refactor of portal reads, RLS, spaces, and email keying.
- **No-copy, portal joins by `native_meeting_id` at read time** — same broad
  portal/RLS refactor.

Chosen: **one bot runs; at persist time the shared artifacts are copied into
each opted-in user's existing `meetings` row, and per-user extraction/emails run
once per user.** Minimal schema change; the portal, RLS, spaces, and the email
system keep working unchanged because every user still owns their own row and
their own copy of the notes — exactly how Otter/Fireflies present it.

---

## Global Constraints

- **Dedup key** is `native_meeting_id`, which is derived deterministically from
  `meet_url` by `calendar_sync._native_id()` and is present at dispatch time.
  Never dedup on `meetings.id` (per-user) or on `meet_url` string equality
  without normalizing through `_native_id`.
- **Never** write the integer Vexa meeting id into the UUID `vexa_meeting_id`
  column (existing constraint; unchanged).
- All Supabase writebacks stay **best-effort and fully guarded** — a fan-out or
  invite failure must never break a live meeting or the scheduler loop.
- **Authenticated join is retained.** `bot_name` remains inert for the displayed
  name (that is fixed by the bot Google account's own name); do not attempt to
  set the display name per user.
- Bot-on-invite is applied **only to events the lead user organizes**, to avoid
  emailing the bot address to external attendees. It is gated on the user having
  granted calendar-write and is a no-op otherwise.
- Reuse existing modules: `email/outbox.enqueue`, `agent/persistence`,
  `agent/actions` post-meeting extraction. No new email infra.
- The lead-selection heuristic is fixed and total: organizer → most attendees →
  earliest `created_at` → (tie) smallest `meetings.id`.

---

## Data model changes

Migration `portal/supabase/migrations/0019_meeting_dedup.sql`:

1. Extend the `bot_status` check to add `'grouped'`:
   `check (bot_status in ('pending','joining','in_meeting','done','failed','grouped'))`.
   - `grouped` = "a sibling row whose bot is being driven by the lead row; do not
     dispatch its own bot." It is a terminal-until-fanout dispatch state, resolved
     to `done`/`failed` by fan-out.
2. Add `bot_lead_meeting_id uuid null references public.meetings(id) on delete set null`.
   - On the lead row: null (it is its own lead).
   - On a grouped sibling: the lead row's `meetings.id`.
3. Index `create index if not exists meetings_native_status_idx on public.meetings (native_meeting_id, bot_status);`
   to make sibling/group lookups cheap.

No changes to `transcript_segments`, `summaries`, `action_items`,
`agent_actions`, `email_outbox`, or `email_prefs`.

## Config change

`src/stewardai/config.py`: add `vexa_bot_email: str = ""` (the authenticated
bot account's address, e.g. `bot@meetbase.site`). Empty disables the
bot-on-invite step (graceful no-op).

---

## Component 1 — Dispatch-time dedup (`scheduler/meeting_scheduler.py`)

Change `run_once` from "dispatch every due row" to "group, then dispatch one bot
per group":

1. `get_due_meetings` gains `native_meeting_id` in its select (already selected).
2. Group the due rows by `native_meeting_id`. Rows with a null
   `native_meeting_id` are dispatched individually as today (no group).
3. For each group of size ≥ 1, pick the **lead** by the fixed heuristic:
   organizer flag if available on the row → else most `attendees` → else earliest
   `created_at` → else smallest `id`.
   - Organizer signal: `meetings` does not currently store an organizer flag.
     Add `is_organizer boolean` **only if** already derivable from calendar sync;
     otherwise the heuristic starts at "most attendees". (Plan task will check
     `calendar_sync._rows_and_events` — if organizer is known there, persist it;
     if not, drop the organizer tier. Do **not** add calendar scope for this.)
4. Dispatch the bot for the **lead only** (`dispatch_meeting`). On success:
   - lead row → `bot_status='joining'` (+ `native_meeting_id` writeback as today);
   - each non-lead group row → `bot_status='grouped'`,
     `bot_lead_meeting_id = <lead id>`.
5. On lead dispatch failure: mark the **lead** `failed` and enqueue its
   `bot_failed` email as today. Non-lead rows are left `pending` so a later poll
   can retry the group (a new lead is chosen if the old lead is now `failed`).

Idempotency: a group whose lead is already `joining`/`in_meeting` (found via the
new index) is skipped — never re-dispatched.

## Component 2 — Reliable join: bot on invite (`scheduler`, Composio)

Before spawning the lead bot, best-effort add the bot to the invite so it skips
the waiting room:

- Only when: `vexa_bot_email` is set **and** the lead user organizes the event
  **and** the lead user has calendar-write granted.
- Action: Composio `GOOGLECALENDAR_UPDATE_EVENT` (or the add-attendee slug the
  plan confirms) adding `vexa_bot_email` as an attendee to the lead's
  `google_event_id`.
- Fully guarded: any failure logs and falls through to the current authenticated
  ask-to-join. Never blocks dispatch.

## Component 3 — Fan-out at persist time (`agent/meeting_runner.py` teardown)

At meeting teardown, after the summary is generated for the resolved (lead) user,
fan out instead of writing to a single row:

1. **Resolve siblings**: select all `meetings` rows where
   `native_meeting_id = <this native id>` and `opted_in = true` and
   `bot_status in ('joining','in_meeting','grouped','done')` and `start_time`
   within the same join window. This yields the lead + all grouped rows. Guarded;
   on failure, fall back to the single resolved row (current behavior).
2. **Shared artifacts** — for each sibling `meetings.id`, call the existing
   `persist_meeting_artifacts(client, meeting_uuid, transcript, summary)`. It is
   idempotent (delete-then-insert transcript, upsert summary), so re-runs
   converge. Transcript + summary are identical across users.
3. **Per-user extraction** — for each sibling `user_id`, run the existing
   post-meeting Composio extraction (`agent/actions`) with **that user's** tools
   and space, writing `action_items`/`agent_actions` on **that user's**
   `meeting_id`. A user with no connected tools is skipped exactly as today.
4. **Status**: mark every sibling row `done` (guarded, keyed by `meeting_id`).

Live in-meeting behavior is unchanged and still driven by the single resolved
lead user (profile, keyterms, brief, live actions/speech). Only the post-meeting
persistence fans out. This is the documented limitation: non-lead users get the
shared notes + their own post-meeting actions/emails, but not live-speech
personalization.

## Component 4 — Per-user post-meeting emails (`meeting_runner` teardown)

Within the same fan-out loop, for each sibling user enqueue the post-meeting note
email through the existing outbox:

- `enqueue(client, user_id=<sibling>, kind="meeting_notes",
  to_email=<owner email via resolve_owner_email>, dedup_key=f"notes:{meeting_id}",
  meeting_id=<sibling meeting_id>, payload={...}, enabled=settings.email_enabled)`.
- The `notes_recipients` config (`meetings.notes_recipients` → fall back to
  `email_prefs.notes_recipients`, `only_me` default) governs whether the note
  also goes to other calendar attendees — **per sibling user**, honoring the
  recipient model already built in the email system. `dedup_key` keyed on the
  per-user `meeting_id` ensures each user is emailed once and re-runs never
  double-send.
- This is the natural wiring point for the `meeting_notes` touchpoint (the email
  foundation defined the `meeting_notes` kind + templates but left the enqueue
  site to the notes-producing path — this is that site).

---

## Data flow

```
calendar_sync ──> meetings rows (per user, same native_meeting_id)
                     │
scheduler.run_once ──> group by native_meeting_id
                     │      └─ pick lead (organizer→most attendees→earliest)
                     │      └─ [best-effort] add bot email to lead's invite
                     ├─ lead        → spawn 1 bot, bot_status=joining
                     └─ non-leads   → bot_status=grouped, bot_lead_meeting_id=lead
                     │
Vexa bot ──> multiplexer connection ──> resolves lead user_id
                     │  (live meeting: transcript, live actions/speech = lead)
                     ▼
runner teardown ──> generate summary (once)
                     └─ resolve siblings (native_meeting_id, opted_in)
                        ├─ persist transcript+summary to EACH sibling meeting_id
                        ├─ per sibling user: post-meeting action extraction (own tools)
                        ├─ per sibling user: enqueue meeting_notes email (own config)
                        └─ mark EACH sibling bot_status=done
```

## Error handling

- Every new DB read/write is guarded; failure degrades to current single-user
  behavior (fan-out falls back to the resolved lead row only).
- Sibling resolution returning only the lead (e.g. transient DB error) is safe —
  it behaves exactly like today.
- `grouped` rows never spawn their own bot; if the lead bot fails to join, the
  group's rows are left recoverable (see Component 1.5).
- Bot-on-invite failure is silent (logged) and never blocks the join.
- Email enqueue swallows dedup-key violations (already implemented).

## Testing

- **Dedup grouping**: given 3 due rows sharing a `native_meeting_id` (+ 1 with a
  different id, + 1 with null id), `run_once` spawns exactly 2 bots (one for the
  group's lead, one for the standalone), sets the group's non-leads to `grouped`
  with `bot_lead_meeting_id`, and dispatches the null-id row individually.
- **Lead selection**: organizer wins over attendee count; with no organizer,
  most-attendees wins; ties fall to earliest `created_at`.
- **Idempotent re-poll**: a group whose lead is already `joining` is not
  re-dispatched on the next `run_once`.
- **Fan-out persistence**: teardown with 3 siblings writes transcript+summary to
  all 3 `meeting_id`s; a sibling with no Composio tools gets notes but no action
  items; all 3 end `done`.
- **Per-user emails**: 3 siblings → 3 `meeting_notes` outbox rows with distinct
  `dedup_key`s; a second teardown run enqueues 0 new rows (dedup).
- **Bot-on-invite gating**: non-organizer lead → no calendar write attempted;
  organizer lead without write scope → no write, dispatch still proceeds.
- **Fallback**: sibling-resolution failure → artifacts written only to the lead
  row (current behavior), no crash.

## Rollout / safety

- The `'grouped'` status + `bot_lead_meeting_id` are additive; existing rows are
  unaffected.
- Fan-out is guarded to degrade to single-user behavior, so shipping the runner
  change before the scheduler change is safe (it just won't have siblings yet).
- Bot-on-invite is off until `vexa_bot_email` is set in the Hetzner `.env`.
- Cross-meeting concurrency remains a known limitation, called out for the
  account-pool spec.
