# Meeting Intelligence — Chat/Timeline View with Attributed Actions

**Date:** 2026-07-02
**Status:** Approved design → implementation
**Parent spec:** `2026-07-02-production-mvp-requirements.md` (§2 Meeting Intelligence UI)
**Scope:** Full-stack — the Python agent (`src/stewardai/`), a Supabase migration (`portal/supabase/migrations/`), and the portal (`portal/src/`).

---

## 1. Goal

Replace the tabbed meeting-detail page with a **content-dense, chat/timeline** experience like modern AI products, where each of Steward's actions is **attributed to the transcript utterance that produced it** and shown inline as collapsible "step" cards (tool icon + status when collapsed, full detail + approve/dismiss when expanded) — plus a consolidated "Actions & tasks" section listing everything.

Recurring-series grouping on the meetings home (parent spec §2.1) is **out of scope** for this slice.

## 2. Current state

- **Detail page** `portal/src/app/app/meetings/[id]/page.tsx` is a `Tabs` layout (Transcript / Summary / Action Items / Steward's Actions). RLS-scoped reads already in place.
- **Data:**
  - `transcript_segments (meeting_id, seq, speaker, text, created_at)` — written by `persistence.py`: live per-utterance inserts, then a teardown **delete-then-insert of the full set** with `seq = enumerate(transcript)`. Segment UUIDs are therefore **not stable** across teardown.
  - `agent_actions (…, source, toolkit, action_slug, args, title, state, result, created_at)` — created live (`live_tools.py`, `source='directed'`) and post-meeting (`actions.py::extract_post_meeting_actions`, LLM over the labeled transcript). No link to the originating utterance today.
  - `action_items (owner, task, due, done, created_at)` — created only at teardown from `summary.py::generate_summary` output. No source link today.
- **Components:** `TranscriptPanel` (live 2s poll), `SummaryPanel`, `ActionItemsPanel` (checkbox toggle), `AgentActionsPanel` (269 lines; toolkit icons, state badges, approve/dismiss).

## 3. Design

### 3.1 Linkage key: `source_seq` (integer), not a UUID FK

Because both action tables are produced by an LLM pass over the transcript `list[str]`, and persistence numbers segments with `seq = enumerate(transcript)`, the stable link is the **line index**:

- Number the transcript lines **0-based** in each extraction/summary prompt (identical to `enumerate(transcript)`).
- The LLM returns a `source_line` integer per emitted item.
- Store it as `source_seq` on the action row.
- The portal joins `action.source_seq == transcript_segments.seq` within the meeting.

This is immune to the teardown delete-then-insert (the same list re-derives the same `seq`), needs no FK, and degrades cleanly (`source_seq` null → not attached inline).

### 3.2 Schema — migration `0007_action_source_seq.sql`

```sql
alter table public.agent_actions add column if not exists source_seq integer;
alter table public.action_items  add column if not exists source_seq integer;
```

Nullable; no backfill (existing rows stay null → consolidated-only in the UI). No RLS change (policies are row-level, unaffected by a new column).

### 3.3 Agent (Python) changes

**`agent/summary.py`**
- `_SUMMARY_SYSTEM`: action-item object schema becomes `{owner, task, due, source_line}` where `source_line` is the 0-based index of the transcript line that motivated the item (null if none).
- `generate_summary`: number the transcript in the prompt body (`f"{i}: {line}"`), so the LLM's `source_line` matches `enumerate` indices.

**`agent/actions.py`**
- `_EXTRACT_SYSTEM`: add a `source_line` field (0-based transcript line index; null if none) to the required object shape.
- `_build_extraction_prompt`: prefix each transcript line with its index (`f"{i}: {line}"`).
- `extract_post_meeting_actions`: read `source_line` from each item (coerce to int or None) and pass to `writer.insert(source_seq=…)`.

**`agent/actions.py::AgentActionsWriter.insert`**
- Add optional `source_seq: int | None = None`; include in the row dict only when not None.

**`agent/live_tools.py::_execute_and_log`**
- For live `source='directed'` inserts, pass `source_seq` = index of the utterance being answered (best-effort: the current transcript length − 1 at handler-invocation time). If the value isn't reliably available, pass None (degrades to consolidated-only) — never guess a wrong index.

**`agent/persistence.py`**
- `persist_meeting_artifacts`: when inserting `action_items`, include `source_seq` from each summary item (coerce to int or None). Transcript seq numbering already equals `enumerate(transcript)` — keep it.

**Ordering note:** summary/extraction and transcript persistence all read the *same* in-memory `transcript` list, so numbering is consistent regardless of write order.

### 3.4 Portal UI

Replace the `Tabs` detail page with a single scroll:

**Header** (`MeetingHeader`) — title, date, duration (`start_time`→`end_time`), status badge, Join link. (Attendees are not in the data model → omitted, not faked.)

**Summary + Actions block** (`MeetingSummary`) — TL;DR, Decisions, Discrepancies (from `summaries`), then the consolidated **"Actions & tasks"**: all `agent_actions` (via reused approve/dismiss) and all `action_items` (checkbox). This is the complete list, independent of inline attribution.

**Timeline** (`MeetingTimeline`, client) — merges `transcript_segments` (ordered by `seq`) into message blocks. When live (`bot_status === 'in_meeting'`) polls `transcript_segments` **and** `agent_actions` every 2s (extends the existing poll). Each block:
- `TimelineMessage`: `SpeakerAvatar` (initials + deterministic color from `speaker-colors.ts`), speaker name, clock timestamp (`created_at`), text. Agent's own lines (`speaker` == bot name) get distinct accent styling.
- Under a message, `ActionStepStrip` renders the actions whose `source_seq === segment.seq`:
  - **Collapsed (default):** row of toolkit icons (reuse `AgentActionsPanel`'s `ToolkitIcon`), a step count ("Steward ran N steps"), and an aggregate status pill derived from the steps' states (any `proposed` → "Needs approval"; any `running` → "Running…"; all `done` → "Done"; any `failed` → "Failed").
  - **Expanded:** numbered `ActionStepCard`s — icon, action title, human-readable args summary, per-step state badge, Approve/Dismiss (reused from `AgentActionsPanel`), result/error when present.

**Pure, unit-tested utils:**
- `lib/meetings/timeline.ts` — `buildTimeline(segments, agentActions)` → ordered `TimelineItem[]`, each a segment with its attached actions (matched by `source_seq === seq`); actions with null/unmatched `source_seq` are returned separately for the consolidated section. Tie-break equal `seq`/timestamps by `seq` then `created_at`.
- `lib/meetings/speaker-colors.ts` — `speakerColor(name)` → a stable Tailwind class pair (bg/text) via a deterministic hash; same name → same color across renders.

**Reuse/refactor:** extract the single-action rendering + approve/dismiss out of `AgentActionsPanel` into a shared `ActionStepCard` so both the consolidated section and the inline expansion use one implementation (DRY). `AgentActionsPanel` becomes a thin list over `ActionStepCard`.

**Graceful degradation:** rows with null `source_seq` (all pre-migration meetings) produce no inline strip; they appear only in the consolidated section. The page is fully functional for old and new meetings.

## 4. Error / empty / loading states

- No segments + not done → "Transcript will appear here once the meeting starts." with a subtle live indicator when `in_meeting`.
- Done + no segments → "No transcript captured."
- No summary → "Summary will appear after the meeting ends." (via `.maybeSingle()` null).
- Skeleton components for the summary block and timeline during the client hydrate/poll.
- Coherent light + dark via existing CSS variables (`foreground`, `muted`, `primary`, `card`, `border`, accent).

## 5. Testing

- **Python (pytest):** `generate_summary` emits `source_line` and it survives to `action_items.source_seq` (stub LLM); `extract_post_meeting_actions` reads `source_line` → `agent_actions.source_seq` (incl. null when omitted, and coercion of bad values); `AgentActionsWriter.insert` includes `source_seq` only when provided.
- **Portal (Jest):** `buildTimeline` — attach-by-seq, unmatched/null → consolidated, ordering/tie-breaks, agent-vs-human classification; `speaker-colors` — determinism and stability.
- **Manual:** migration applied; process a meeting (or seed rows with `source_seq`) → inline collapsed strip shows icons + status, expands to steps with working approve/dismiss; a null-`source_seq` meeting shows everything in the consolidated section only; live poll updates during `in_meeting`.
- `next build` + `npm test` + `pytest`/`ruff` green.

## 6. Out of scope (this slice)

- Recurring-series grouping on the meetings home (parent §2.1) — separate slice.
- Attendees (not in the data model).
- Summary-point → transcript deep-linking beyond action attribution.
- Backfilling `source_seq` for historical meetings.
