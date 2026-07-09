# Steward Knowledge Base L3 — Living Brief (design)

**Date:** 2026-07-09
**Status:** Approved (pending spec review)
**Type:** Product design — completes the KB north-star (L0/L1/L2 already shipped)
**Builds on:** `docs/superpowers/specs/2026-07-03-steward-knowledge-base-design.md`

## Context

The knowledge base is built bottom-up in four layers. **L0 (Spaces + filing), L1
(index/embed), and L2 (Ask/RAG) are shipped.** L3 — the "it just knows" layer —
is the remaining work. L3 has three pieces, each its own spec → plan → build
cycle. This document sketches all three so the shape is agreed, and specifies
the **first** in full: the **Living Brief**. The other two (live voice
injection, proactive nudges) are described at overview depth only and will each
get their own spec when reached.

Dependency order (from the KB north-star's approved priority sequence): the
living brief is the foundation; voice injection reads it; nudges come from its
regeneration diffs.

## L3 overview (all three pieces)

| Piece | What it is | Status |
|---|---|---|
| **Living brief** | A maintained narrative "state of this thread" per Space, regenerated from the Space's facts + recent summaries after each meeting; shown on the Space page and as a pre-meeting briefing. | **This spec — built now.** |
| **Live voice injection** | At meeting start, load the home Space's brief + facts into the in-meeting voice agent's context so it speaks with full background and never contradicts a past decision. | Later — own spec. Reads the brief. |
| **Proactive nudges** | Diff facts/brief across regenerations to emit signals (new open item, decision contradicts a past one, deadline approaching); delivered in-portal first. | Later — own spec. Comes from brief regeneration diffs. |

## Living Brief — design (built this cycle)

### Concept

Each Space owns a short **narrative brief** — a few paragraphs answering "where
are we on this thread?" — synthesized from the Space's structured facts (open
items, decisions, key dates, risks, open questions) and its most-recent meeting
summaries. It is **regenerated wholesale** after each meeting (and on demand), so
it is always current, fully sourced, and can never silently drift into fiction.

### Generation strategy (decided)

**Regenerate from facts after each meeting** (not incremental patching, not
lazy on-view). One LLM synthesis pass over the Space's current live facts +
recent summaries produces a fresh brief that fully replaces the prior one.
Rationale: facts are small (cheap tokens), the output stays honest and
verifiable, and a stored brief is the substrate the later voice-injection and
nudge pieces need.

### Data model

New table `space_briefs` (Supabase migration), RLS own-row like the other KB
tables; service-role code re-filters by `user_id`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid | FK → `auth.users(id)` on delete cascade |
| `space_id` | uuid | FK → `spaces(id)` on delete cascade, **UNIQUE** (one current brief per Space) |
| `text` | text | the brief, markdown, with `[n]` citation markers |
| `model` | text | model id used (observability) |
| `source_meeting_ids` | uuid[] | meetings whose facts/summaries fed this brief (for the UI's citation resolution + "based on N meetings") |
| `generated_at` | timestamptz | `now()` on each regenerate |

Upserted on `space_id` (one row per Space, replaced each regenerate).

### Generation module — `src/stewardai/agent/kb/brief.py` (new)

- `async def regenerate_space_brief(client, llm, *, user_id, space_id) -> dict | None`
  1. Load the Space's **live (non-superseded) facts** grouped by kind, plus the
     **N most-recent meeting summaries** for meetings filed in the Space
     (N capped, e.g. 8, to bound tokens).
  2. **Skip** (return `None`, delete/leave no brief) if the Space has **no
     facts** — nothing to summarize.
  3. Build a numbered context (fact/summary → `meeting_id`), call
     `llm.complete()` with a synthesis system prompt that instructs a concise
     narrative brief citing sources as `[n]` (same citation contract as
     `agent/kb/ask.py`).
  4. Upsert into `space_briefs` with `text`, `model`, `source_meeting_ids`,
     `generated_at`.
  5. Wrap in `usage_scope(feature="brief", user_id=...)` (matches existing usage
     logging).
- Pure, testable helpers factored out: the fact-grouping→prompt builder and the
  citation numbering (reuse the `ask.py` snippet/citation approach).

### Triggers

- **Automatic:** in `src/stewardai/agent/kb/ingest.py`, after facts roll-up
  (the north-star's step 5), call `regenerate_space_brief` for the meeting's
  home `space_id` — only when `space_id` is set and facts exist. Best-effort:
  a brief failure must not fail ingestion (log + continue).
- **Manual:** `POST /api/spaces/[id]/brief` (portal route, service-role,
  own-space check) → invokes the same backend regenerate path → returns the new
  brief. Backed by a **"Regenerate"** button on the Space page (lets a user
  refresh after re-filing meetings).

### Portal UI

- **Space detail (`/app/spaces/[id]`)** gains a **"Brief — state of this
  thread"** card at the **top**, above "What's known":
  - The narrative, rendered with `[n]` **citation links** to the source meetings
    (reuse `splitAnswerWithCitations` + the existing citation link pattern;
    resolve `[n]` → `source_meeting_ids`).
  - An **"Updated <relative time> · based on N meetings"** line.
  - A **Regenerate** button (calls the manual route, shows busy + inline error).
  - **Empty state** when no brief exists: "No brief yet — it'll appear after the
    next meeting in this Space, or regenerate now."
- **Pre-meeting briefing (light):** on the meeting detail page's Space section,
  if the meeting's home Space has a brief, surface it as a compact **"Going in"**
  read-only excerpt (no generation here — just render the stored brief). Defers
  the richer pre-meeting surface to the voice-injection cycle.

### Error handling & cost

- No facts → no brief (skip; not an error).
- LLM/generation failure → leave the previous brief intact; automatic path logs
  and continues; manual route returns a non-blocking error the UI shows.
- Token bounds: cap facts and the number of recent summaries fed in.
- Usage attributed `feature="brief"`.
- Re-filing a meeting (facts re-parented via `PUT /api/meetings/[id]/space`)
  does not auto-regenerate affected Spaces in v1; the next ingestion or the
  manual Regenerate button refreshes them. (Noted; auto-regenerate-on-refile is
  a later nicety.)

### Testing

- **Pure/unit:** fact-grouping→prompt builder; citation numbering/mapping; the
  "skip when no facts" guard; `source_meeting_ids` derivation.
- **Integration (backend):** `ingest_meeting_kb` triggers a regenerate when a
  home Space + facts exist, and does **not** when facts are absent; a generation
  failure does not fail ingestion.
- **Route:** `POST /api/spaces/[id]/brief` — auth (401), own-space check (404 on
  another user's space), success returns the brief.
- **Portal:** brief card render + empty state; citation `[n]` → meeting link
  resolution; Regenerate busy/error states.

## Non-goals (this cycle)

- Live voice injection and proactive nudges (later cycles; sketched above).
- Auto-regenerate on meeting re-file (manual button / next ingestion covers it).
- Brief version history / diff UI (only the current brief is stored; nudges will
  introduce diffing in their own cycle).
- Sharing briefs across teammates.

## Risks

- **Synthesis quality/faithfulness** — mitigated by regenerate-from-facts +
  mandatory citations; the brief can always be re-derived and checked against
  its sources.
- **Token cost per meeting** — bounded by capping facts + recent summaries and
  skipping factless Spaces.
