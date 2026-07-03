# Knowledge Base — Plan A1: Schema + Backend Filing/Extraction (L0 backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every meeting, Steward extracts entities + facts, files the meeting into a Space (confidence-graduated), and persists it all — so meetings become organized threads in the DB, ready for the portal UI (A2) and indexing/Ask (B).

**Architecture:** A new `src/stewardai/agent/kb/` package holds pure filing logic, LLM extraction (extending the existing `summary.py` pattern), entity resolution, and Supabase persistence, tied together by an `ingest_meeting_kb(...)` orchestrator invoked from `MeetingSession.teardown()`. A single idempotent Supabase migration (`0009_knowledge_base.sql`) adds the tables. No ORM — direct async Supabase service-client calls, mirroring `src/stewardai/agent/persistence.py`.

**Tech Stack:** Python 3.11 (async), Supabase Postgres (PostgREST client, service-role key bypasses RLS), litellm via `LiteLLMClient`, pytest (`asyncio_mode="auto"`).

## Global Constraints

- Migrations are idempotent Supabase SQL in `portal/supabase/migrations/NNNN_name.sql` — use `create table if not exists` / `add column if not exists`; no down-migrations. Next number is `0009`.
- Every new table has `user_id uuid not null references auth.users(id)`, RLS enabled, and an own-row policy `user_id = auth.uid()` (mirror `0002_rls_policies.sql` / `0004_agent_actions.sql`). Reuse `public.set_updated_at()` for any `updated_at`.
- DB access is the async Supabase client only (`.table(...).select/insert/upsert/update/delete(...).eq(...).execute()`); no ORM, no asyncpg. Mirror `src/stewardai/agent/persistence.py`.
- All persistence is user-scoped: write `user_id` on every row and filter reads by `.eq("user_id", user_id)` even though the service client bypasses RLS.
- Every fact carries provenance: `meeting_id` (source meeting UUID) and `source_seq` (0-based transcript line index, or null) — mirror `action_items.source_seq` (migration `0007`).
- Confidence thresholds are module constants: `HIGH_CONFIDENCE = 0.75`, `LOW_CONFIDENCE = 0.40` (spec leaves exact values as a tuning question; these are the defaults).
- Extend, don't duplicate: reuse the action items already produced by `generate_summary`; only add entities/decisions/dates/risks/open-questions.
- Tests never hit a real DB: use hand-rolled fake Supabase clients (mirror `tests/agent/test_persistence.py`) and mock `llm.complete` as an async generator (mirror `tests/agent/test_summary.py`).
- DRY, YAGNI, TDD, frequent commits.

---

### Task 1: KB schema migration

**Files:**
- Create: `portal/supabase/migrations/0009_knowledge_base.sql`

**Interfaces:**
- Consumes: `public.set_updated_at()` (from `0001`), `auth.users(id)`, `public.meetings(id)`.
- Produces: tables `spaces`, `entities`, `meeting_entities`, `meeting_tags`, `space_facts`, `filing_hints`; new columns `meetings.space_id`, `meetings.space_confidence`, `meetings.space_source`.

- [ ] **Step 1: Write the migration**

```sql
-- 0009_knowledge_base.sql — Knowledge Base L0: spaces, entities, tags, facts, filing hints.

-- Spaces: flexible, nestable container; the home for meetings.
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_id uuid references public.spaces(id) on delete set null,
  kind text check (kind in ('client','project','topic')),   -- cosmetic label; nullable
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists spaces_updated_at on public.spaces;
create trigger spaces_updated_at before update on public.spaces
  for each row execute function public.set_updated_at();

-- Entities: global (per user) people & companies.
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('person','company')),
  name text not null,
  email text,
  domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists entities_updated_at on public.entities;
create trigger entities_updated_at before update on public.entities
  for each row execute function public.set_updated_at();
create index if not exists entities_user_email_idx on public.entities (user_id, lower(email));
create index if not exists entities_user_domain_idx on public.entities (user_id, lower(domain));

-- Meeting -> entity links (many-to-many).
create table if not exists public.meeting_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  unique (meeting_id, entity_id)
);

-- Meeting -> topic tags (free-form, many per meeting).
create table if not exists public.meeting_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, tag)
);

-- Space-level facts, rolled up from member meetings; each links to its source.
create table if not exists public.space_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,   -- source (provenance)
  kind text not null check (kind in ('action_item','decision','date','risk','open_question')),
  text text not null,
  owner text,
  due date,
  status text,
  source_seq integer,
  superseded_by uuid references public.space_facts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists space_facts_space_idx on public.space_facts (space_id, kind);

-- Filing hints: learned signal -> space mappings (updated on corrections).
create table if not exists public.filing_hints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('attendee_email','domain','series')),
  value text not null,
  space_id uuid not null references public.spaces(id) on delete cascade,
  weight integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, kind, value, space_id)
);

-- Meeting filing metadata.
alter table public.meetings add column if not exists space_id uuid references public.spaces(id) on delete set null;
alter table public.meetings add column if not exists space_confidence real;
alter table public.meetings add column if not exists space_source text
  check (space_source in ('recurring','auto','auto_created','manual','suggested','unfiled'));

-- RLS: own-row on every table (service-role key bypasses; anon/cookie client is scoped).
alter table public.spaces enable row level security;
alter table public.entities enable row level security;
alter table public.meeting_entities enable row level security;
alter table public.meeting_tags enable row level security;
alter table public.space_facts enable row level security;
alter table public.filing_hints enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='spaces' and policyname='spaces_own') then
    create policy spaces_own on public.spaces for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='entities' and policyname='entities_own') then
    create policy entities_own on public.entities for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='meeting_entities' and policyname='meeting_entities_own') then
    create policy meeting_entities_own on public.meeting_entities for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='meeting_tags' and policyname='meeting_tags_own') then
    create policy meeting_tags_own on public.meeting_tags for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='space_facts' and policyname='space_facts_own') then
    create policy space_facts_own on public.space_facts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='filing_hints' and policyname='filing_hints_own') then
    create policy filing_hints_own on public.filing_hints for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
```

- [ ] **Step 2: Verify the SQL applies (no unit test — this is DDL)**

Run against a scratch Postgres (or `npx supabase db push` on a dev project):
```bash
psql "$SCRATCH_DATABASE_URL" -f portal/supabase/migrations/0009_knowledge_base.sql
```
Expected: no errors. Re-run the same command a second time — expected: still no errors (idempotent). Then confirm the tables exist:
```bash
psql "$SCRATCH_DATABASE_URL" -c "\dt public.spaces public.entities public.space_facts public.filing_hints public.meeting_entities public.meeting_tags"
psql "$SCRATCH_DATABASE_URL" -c "\d public.meetings" | grep -E "space_id|space_confidence|space_source"
```
Expected: all six tables listed; three new `meetings` columns present.

- [ ] **Step 3: Commit**

```bash
git add portal/supabase/migrations/0009_knowledge_base.sql
git commit -m "feat(kb): schema for spaces, entities, tags, facts, filing hints"
```

---

### Task 2: Filing decision logic (pure functions)

**Files:**
- Create: `src/stewardai/agent/kb/__init__.py`
- Create: `src/stewardai/agent/kb/filing.py`
- Test: `tests/agent/kb/test_filing.py`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `HIGH_CONFIDENCE: float = 0.75`, `LOW_CONFIDENCE: float = 0.40`
  - `@dataclass(frozen=True) SpaceCandidate(space_id: str, score: float, reason: str)`
  - `@dataclass(frozen=True) FilingDecision(action: str, space_id: str | None, confidence: float, reason: str, new_space_name: str | None = None)` where `action ∈ {"recurring","auto","auto_created","suggested","unfiled"}`
  - `score_candidates(*, hint_scores: dict[str, float]) -> list[SpaceCandidate]`
  - `decide_filing(*, recurring_space_id: str | None, candidates: list[SpaceCandidate], new_thread_name: str | None) -> FilingDecision`

- [ ] **Step 1: Write the failing tests**

```python
# tests/agent/kb/test_filing.py
from stewardai.agent.kb.filing import (
    HIGH_CONFIDENCE, LOW_CONFIDENCE, SpaceCandidate, decide_filing, score_candidates,
)


def test_score_candidates_sorted_desc_and_clamped():
    cands = score_candidates(hint_scores={"s1": 0.2, "s2": 0.9, "s3": 1.5})
    assert [c.space_id for c in cands] == ["s3", "s2", "s1"]
    assert cands[0].score == 1.0  # clamped to [0, 1]


def test_recurring_meeting_inherits_series_space():
    d = decide_filing(recurring_space_id="series-space", candidates=[], new_thread_name=None)
    assert d.action == "recurring" and d.space_id == "series-space" and d.confidence == 1.0


def test_high_confidence_candidate_auto_files():
    cands = [SpaceCandidate("s1", 0.9, "domain match")]
    d = decide_filing(recurring_space_id=None, candidates=cands, new_thread_name=None)
    assert d.action == "auto" and d.space_id == "s1" and d.confidence == 0.9


def test_new_thread_high_confidence_auto_creates_when_no_candidates():
    d = decide_filing(recurring_space_id=None, candidates=[], new_thread_name="Acme Corp")
    assert d.action == "auto_created" and d.space_id is None and d.new_space_name == "Acme Corp"


def test_medium_confidence_is_suggested():
    cands = [SpaceCandidate("s1", 0.5, "one attendee")]
    d = decide_filing(recurring_space_id=None, candidates=cands, new_thread_name=None)
    assert d.action == "suggested" and d.space_id == "s1"


def test_low_confidence_and_no_new_thread_is_unfiled():
    cands = [SpaceCandidate("s1", 0.2, "weak")]
    d = decide_filing(recurring_space_id=None, candidates=cands, new_thread_name=None)
    assert d.action == "unfiled" and d.space_id is None


def test_existing_candidate_wins_over_new_thread_when_high():
    # A strong existing match should file into it, not spawn a duplicate space.
    cands = [SpaceCandidate("s1", 0.95, "domain+attendees")]
    d = decide_filing(recurring_space_id=None, candidates=cands, new_thread_name="Acme Corp")
    assert d.action == "auto" and d.space_id == "s1"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/agent/kb/test_filing.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stewardai.agent.kb'`.

- [ ] **Step 3: Implement**

```python
# src/stewardai/agent/kb/__init__.py
"""Knowledge Base (L0): entity/fact extraction, confidence-graduated filing, persistence."""
```

```python
# src/stewardai/agent/kb/filing.py
"""Pure, testable filing logic: score candidate Spaces and choose an action.

No DB or LLM here — callers precompute signal scores (from filing_hints + entity
overlap) and pass them in. Keeping this pure makes the confidence-graduated rule
(recurring -> auto -> auto_created -> suggested -> unfiled) trivial to unit-test.
"""
from __future__ import annotations

from dataclasses import dataclass

HIGH_CONFIDENCE = 0.75
LOW_CONFIDENCE = 0.40


@dataclass(frozen=True)
class SpaceCandidate:
    space_id: str
    score: float
    reason: str


@dataclass(frozen=True)
class FilingDecision:
    action: str  # "recurring" | "auto" | "auto_created" | "suggested" | "unfiled"
    space_id: str | None
    confidence: float
    reason: str
    new_space_name: str | None = None


def score_candidates(*, hint_scores: dict[str, float]) -> list[SpaceCandidate]:
    """Turn {space_id: raw_score} into clamped, descending SpaceCandidates."""
    cands = [
        SpaceCandidate(space_id=sid, score=max(0.0, min(1.0, s)), reason="signal match")
        for sid, s in hint_scores.items()
    ]
    return sorted(cands, key=lambda c: c.score, reverse=True)


def decide_filing(
    *,
    recurring_space_id: str | None,
    candidates: list[SpaceCandidate],
    new_thread_name: str | None,
) -> FilingDecision:
    """Apply the confidence-graduated rule. Order matters:

    1. recurring series -> inherit (silent).
    2. top existing candidate >= HIGH -> auto-file (an existing match always beats
       spawning a duplicate).
    3. else a confident brand-new thread -> auto-create.
    4. else top candidate >= LOW -> suggest (Unfiled tray with a one-tap guess).
    5. else -> unfiled.
    """
    if recurring_space_id:
        return FilingDecision("recurring", recurring_space_id, 1.0, "recurring series")
    top = candidates[0] if candidates else None
    if top and top.score >= HIGH_CONFIDENCE:
        return FilingDecision("auto", top.space_id, top.score, top.reason)
    if new_thread_name:
        return FilingDecision("auto_created", None, HIGH_CONFIDENCE, "new thread",
                              new_space_name=new_thread_name)
    if top and top.score >= LOW_CONFIDENCE:
        return FilingDecision("suggested", top.space_id, top.score, top.reason)
    return FilingDecision("unfiled", None, top.score if top else 0.0, "no confident match")
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/agent/kb/test_filing.py -v`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/kb/__init__.py src/stewardai/agent/kb/filing.py tests/agent/kb/test_filing.py
git commit -m "feat(kb): pure confidence-graduated filing decision"
```

---

### Task 3: Entity + fact extraction (LLM pass)

**Files:**
- Create: `src/stewardai/agent/kb/extraction.py`
- Test: `tests/agent/kb/test_extraction.py`

**Interfaces:**
- Consumes: `llm.complete(messages, system=..., temperature=...)` (async generator of str deltas) — the `LiteLLMClient` interface at `src/stewardai/llm/litellm_client.py:91`; `Message` from `stewardai.common.audio`.
- Produces: `async def extract_entities_and_facts(llm, transcript: list[str]) -> dict` returning
  `{"entities": [{"kind": "person"|"company", "name": str, "email": str|None}],
    "tags": [str],
    "facts": [{"kind": "decision"|"date"|"risk"|"open_question", "text": str, "source_line": int|None, "due": str|None}]}`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/agent/kb/test_extraction.py
from stewardai.agent.kb.extraction import extract_entities_and_facts


def _llm_yielding(text: str):
    class _LLM:
        async def complete(self, messages, *, system=None, temperature=0.4):
            yield text
    return _LLM()


async def test_parses_entities_tags_and_facts():
    payload = (
        '{"entities":[{"kind":"person","name":"Jane Doe","email":"jane@acme.com"},'
        '{"kind":"company","name":"Acme","email":null}],'
        '"tags":["pricing","renewal"],'
        '"facts":[{"kind":"decision","text":"Dropped tier-3 scope","source_line":4,"due":null},'
        '{"kind":"date","text":"Contract ends","source_line":6,"due":"2026-07-31"}]}'
    )
    out = await extract_entities_and_facts(_llm_yielding(payload), ["[Jane]: hi", "..."])
    assert out["entities"][0] == {"kind": "person", "name": "Jane Doe", "email": "jane@acme.com"}
    assert out["tags"] == ["pricing", "renewal"]
    assert out["facts"][1] == {"kind": "date", "text": "Contract ends", "source_line": 6, "due": "2026-07-31"}


async def test_strips_markdown_fences():
    payload = '```json\n{"entities":[],"tags":[],"facts":[]}\n```'
    out = await extract_entities_and_facts(_llm_yielding(payload), ["x"])
    assert out == {"entities": [], "tags": [], "facts": []}


async def test_malformed_json_returns_empty_shape():
    out = await extract_entities_and_facts(_llm_yielding("not json at all"), ["x"])
    assert out == {"entities": [], "tags": [], "facts": []}


async def test_empty_transcript_short_circuits_without_calling_llm():
    class _Boom:
        async def complete(self, *a, **k):
            raise AssertionError("LLM should not be called for empty transcript")
            yield ""  # pragma: no cover
    assert await extract_entities_and_facts(_Boom(), []) == {"entities": [], "tags": [], "facts": []}
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/agent/kb/test_extraction.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stewardai.agent.kb.extraction'`.

- [ ] **Step 3: Implement**

```python
# src/stewardai/agent/kb/extraction.py
"""One LLM pass that pulls entities, topic tags, and facts from a transcript.

Mirrors stewardai.agent.summary.generate_summary: build a Message, stream
llm.complete deltas, join, strip markdown fences, json.loads with a safe fallback.
Action items are NOT re-extracted here — they already come from generate_summary;
this adds entities + decisions/dates/risks/open-questions only (DRY).
"""
from __future__ import annotations

import json

from stewardai.common.audio import Message
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.extraction")

_EMPTY = {"entities": [], "tags": [], "facts": []}

_SYSTEM = (
    "You extract structured knowledge from a meeting transcript. Return ONLY JSON "
    "with keys: 'entities' (array of {kind:'person'|'company', name, email(or null)}), "
    "'tags' (array of short lowercase topic strings), and 'facts' (array of "
    "{kind:'decision'|'date'|'risk'|'open_question', text, source_line(0-based line "
    "index or null), due('YYYY-MM-DD' or null)}). Only include entities actually "
    "named. Keep tags to at most 6. Do not invent facts."
)


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1] if "\n" in t else t
        if t.endswith("```"):
            t = t[: -3]
    return t.strip()


async def extract_entities_and_facts(llm, transcript: list[str]) -> dict:
    """Return {"entities": [...], "tags": [...], "facts": [...]}; empty shape on failure."""
    if not transcript:
        return {"entities": [], "tags": [], "facts": []}
    body = "\n".join(f"{i}: {line}" for i, line in enumerate(transcript))
    chunks: list[str] = []
    async for delta in llm.complete(
        [Message(role="user", content=body)], system=_SYSTEM, temperature=0.2
    ):
        if delta:
            chunks.append(delta)
    raw = _strip_fences("".join(chunks))
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        _log.warning("kb_extraction_parse_failed", head=raw[:120])
        return {"entities": [], "tags": [], "facts": []}
    return {
        "entities": data.get("entities") or [],
        "tags": data.get("tags") or [],
        "facts": data.get("facts") or [],
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/agent/kb/test_extraction.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/kb/extraction.py tests/agent/kb/test_extraction.py
git commit -m "feat(kb): LLM extraction of entities, tags, and facts"
```

---

### Task 4: Entity resolution (match-or-create against the DB)

**Files:**
- Create: `src/stewardai/agent/kb/entities.py`
- Test: `tests/agent/kb/test_entities.py`

**Interfaces:**
- Consumes: async Supabase client (`.table("entities").select/insert(...).eq(...).execute()`); extracted entities from Task 3 (`{"kind","name","email"}`).
- Produces: `async def resolve_entities(client, *, user_id: str, extracted: list[dict]) -> list[str]` returning entity UUIDs (existing where matched by email, else by exact name+kind; otherwise newly inserted). Also sets `domain` from the email when creating.

- [ ] **Step 1: Write the failing tests**

```python
# tests/agent/kb/test_entities.py
from stewardai.agent.kb.entities import resolve_entities


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table):
        self._t = table
        self._filters = {}

    def select(self, *_a):
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def limit(self, _n):
        return self

    async def execute(self):
        rows = [r for r in self._t.rows
                if all(r.get(k) == v for k, v in self._filters.items())]
        return _Resp(rows)

    def insert(self, payload):
        self._t.inserted.append(payload)
        row = {**payload, "id": f"ent-{len(self._t.rows) + 1}"}
        self._t.rows.append(row)
        self._pending = [row]
        return self


class _Table:
    def __init__(self):
        self.rows = []
        self.inserted = []

    # insert() returns a query whose execute() yields the inserted row
    def select(self, *a):
        return _Query(self).select(*a)

    def insert(self, payload):
        return _Query(self).insert(payload)


class _Client:
    def __init__(self, seed=None):
        self._tables = {"entities": _Table()}
        if seed:
            self._tables["entities"].rows.extend(seed)

    def table(self, name):
        return self._tables[name]


async def test_matches_existing_by_email():
    client = _Client(seed=[{"id": "e1", "user_id": "u1", "kind": "person",
                            "name": "Jane", "email": "jane@acme.com"}])
    ids = await resolve_entities(client, user_id="u1",
                                 extracted=[{"kind": "person", "name": "Jane D", "email": "jane@acme.com"}])
    assert ids == ["e1"]
    assert client.table("entities").inserted == []  # no new row created


async def test_creates_new_with_domain_from_email():
    client = _Client()
    ids = await resolve_entities(client, user_id="u1",
                                 extracted=[{"kind": "person", "name": "Bob", "email": "bob@globex.io"}])
    assert len(ids) == 1
    created = client.table("entities").inserted[0]
    assert created["user_id"] == "u1" and created["domain"] == "globex.io"


async def test_dedupes_within_one_call():
    client = _Client()
    ids = await resolve_entities(client, user_id="u1", extracted=[
        {"kind": "company", "name": "Acme", "email": None},
        {"kind": "company", "name": "Acme", "email": None},
    ])
    assert len(ids) == 1 and len(client.table("entities").inserted) == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/agent/kb/test_entities.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stewardai.agent.kb.entities'`.

- [ ] **Step 3: Implement**

```python
# src/stewardai/agent/kb/entities.py
"""Resolve extracted people/companies to existing global entities, or create them.

Match order: exact email (case-insensitive) -> exact name+kind (case-insensitive).
No fuzzy matching in v1 (spec risk: merging the wrong 'John' — stay conservative).
"""
from __future__ import annotations

from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.entities")


def _domain_of(email: str | None) -> str | None:
    if email and "@" in email:
        return email.split("@", 1)[1].strip().lower() or None
    return None


async def resolve_entities(client, *, user_id: str, extracted: list[dict]) -> list[str]:
    """Return entity UUIDs for the extracted entities (matched or created)."""
    resolved: list[str] = []
    seen_keys: dict[tuple, str] = {}  # de-dupe within this call
    for ent in extracted:
        kind = (ent.get("kind") or "").strip()
        name = (ent.get("name") or "").strip()
        email = (ent.get("email") or None)
        if kind not in ("person", "company") or not name:
            continue
        key = (kind, (email or "").lower(), name.lower())
        if key in seen_keys:
            resolved.append(seen_keys[key])
            continue

        row_id: str | None = None
        if email:
            resp = await (
                client.table("entities").select("id")
                .eq("user_id", user_id).eq("kind", kind).eq("email", email).limit(1).execute()
            )
            if resp.data:
                row_id = resp.data[0]["id"]
        if row_id is None:
            resp = await (
                client.table("entities").select("id")
                .eq("user_id", user_id).eq("kind", kind).eq("name", name).limit(1).execute()
            )
            if resp.data:
                row_id = resp.data[0]["id"]
        if row_id is None:
            resp = await client.table("entities").insert({
                "user_id": user_id, "kind": kind, "name": name,
                "email": email, "domain": _domain_of(email),
            }).execute()
            row_id = resp.data[0]["id"]

        seen_keys[key] = row_id
        resolved.append(row_id)
    return resolved
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/agent/kb/test_entities.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/kb/entities.py tests/agent/kb/test_entities.py
git commit -m "feat(kb): conservative entity match-or-create resolution"
```

---

### Task 5: KB persistence (spaces, links, facts, filing hints)

**Files:**
- Create: `src/stewardai/agent/kb/persistence.py`
- Test: `tests/agent/kb/test_kb_persistence.py`

**Interfaces:**
- Consumes: async Supabase client; `FilingDecision` (Task 2); entity UUIDs (Task 4); extraction dict (Task 3).
- Produces:
  - `async def create_space(client, *, user_id: str, name: str) -> str` → new space UUID.
  - `async def set_meeting_space(client, *, user_id, meeting_id, space_id, confidence, source) -> None`
  - `async def link_meeting_entities(client, *, user_id, meeting_id, entity_ids) -> None`
  - `async def set_meeting_tags(client, *, user_id, meeting_id, tags) -> None` (delete-then-insert, idempotent)
  - `async def insert_facts(client, *, user_id, space_id, meeting_id, facts) -> int` (skips when space_id is None)
  - `async def record_filing_hints(client, *, user_id, space_id, attendee_emails, domains) -> None`

- [ ] **Step 1: Write the failing tests**

```python
# tests/agent/kb/test_kb_persistence.py
from stewardai.agent.kb import persistence as kbp


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, log, table):
        self._log, self._t, self._op, self._payload = log, table, None, None

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def upsert(self, payload, **_k):
        self._op, self._payload = "upsert", payload
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, *_a):
        return self

    async def execute(self):
        self._log.append({"table": self._t, "op": self._op, "payload": self._payload})
        rid = f"{self._t}-1"
        return _Resp([{"id": rid}])


class _Client:
    def __init__(self):
        self.calls = []

    def table(self, name):
        return _Query(self.calls, name)


def _ops(client, table, op):
    return [c["payload"] for c in client.calls if c["table"] == table and c["op"] == op]


async def test_create_space_returns_id_and_writes_user_id():
    c = _Client()
    sid = await kbp.create_space(c, user_id="u1", name="Acme")
    assert sid == "spaces-1"
    assert _ops(c, "spaces", "insert")[0] == {"user_id": "u1", "name": "Acme"}


async def test_insert_facts_writes_provenance_and_skips_when_no_space():
    c = _Client()
    n = await kbp.insert_facts(c, user_id="u1", space_id="s1", meeting_id="m1", facts=[
        {"kind": "decision", "text": "Dropped tier-3", "source_line": 4, "due": None},
        {"kind": "date", "text": "Contract ends", "source_line": 6, "due": "2026-07-31"},
    ])
    assert n == 2
    rows = _ops(c, "space_facts", "insert")[0]
    assert rows[0] == {"user_id": "u1", "space_id": "s1", "meeting_id": "m1",
                       "kind": "decision", "text": "Dropped tier-3", "source_seq": 4, "due": None}
    # no space -> nothing written
    c2 = _Client()
    assert await kbp.insert_facts(c2, user_id="u1", space_id=None, meeting_id="m1",
                                  facts=[{"kind": "risk", "text": "x", "source_line": None, "due": None}]) == 0
    assert c2.calls == []


async def test_set_meeting_tags_is_delete_then_insert():
    c = _Client()
    await kbp.set_meeting_tags(c, user_id="u1", meeting_id="m1", tags=["pricing", "renewal"])
    order = [x["op"] for x in c.calls if x["table"] == "meeting_tags"]
    assert order.index("delete") < order.index("insert")
    assert _ops(c, "meeting_tags", "insert")[0] == [
        {"user_id": "u1", "meeting_id": "m1", "tag": "pricing"},
        {"user_id": "u1", "meeting_id": "m1", "tag": "renewal"},
    ]


async def test_set_meeting_space_updates_meeting_row():
    c = _Client()
    await kbp.set_meeting_space(c, user_id="u1", meeting_id="m1",
                               space_id="s1", confidence=0.9, source="auto")
    assert _ops(c, "meetings", "update")[0] == {
        "space_id": "s1", "space_confidence": 0.9, "space_source": "auto"}
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/agent/kb/test_kb_persistence.py -v`
Expected: FAIL — `AttributeError`/`ImportError` (functions not defined).

- [ ] **Step 3: Implement**

```python
# src/stewardai/agent/kb/persistence.py
"""Write KB rows via the async Supabase service client. Mirrors
stewardai.agent.persistence: user_id on every row, idempotent delete-then-insert
for link tables, each guarded by the caller. No ORM.
"""
from __future__ import annotations

from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.persistence")


async def create_space(client, *, user_id: str, name: str) -> str:
    resp = await client.table("spaces").insert({"user_id": user_id, "name": name}).execute()
    return resp.data[0]["id"]


async def set_meeting_space(client, *, user_id, meeting_id, space_id, confidence, source) -> None:
    await (
        client.table("meetings")
        .update({"space_id": space_id, "space_confidence": confidence, "space_source": source})
        .eq("id", meeting_id).eq("user_id", user_id).execute()
    )


async def link_meeting_entities(client, *, user_id, meeting_id, entity_ids) -> None:
    if not entity_ids:
        return
    rows = [{"user_id": user_id, "meeting_id": meeting_id, "entity_id": eid} for eid in entity_ids]
    # upsert on (meeting_id, entity_id) unique constraint -> idempotent re-runs
    await client.table("meeting_entities").upsert(
        rows, on_conflict="meeting_id,entity_id").execute()


async def set_meeting_tags(client, *, user_id, meeting_id, tags) -> None:
    await client.table("meeting_tags").delete().eq("meeting_id", meeting_id).execute()
    if tags:
        rows = [{"user_id": user_id, "meeting_id": meeting_id, "tag": t} for t in tags]
        await client.table("meeting_tags").insert(rows).execute()


async def insert_facts(client, *, user_id, space_id, meeting_id, facts) -> int:
    if space_id is None or not facts:
        return 0
    rows = [{
        "user_id": user_id, "space_id": space_id, "meeting_id": meeting_id,
        "kind": f.get("kind"), "text": f.get("text"),
        "source_seq": f.get("source_line"), "due": f.get("due"),
    } for f in facts if f.get("kind") and f.get("text")]
    if not rows:
        return 0
    await client.table("space_facts").insert(rows).execute()
    return len(rows)


async def record_filing_hints(client, *, user_id, space_id, attendee_emails, domains) -> None:
    """Upsert signal->space hints so future filing for this user gets more confident."""
    rows = []
    for email in attendee_emails or []:
        rows.append({"user_id": user_id, "kind": "attendee_email", "value": email.lower(),
                     "space_id": space_id, "weight": 1})
    for dom in domains or []:
        rows.append({"user_id": user_id, "kind": "domain", "value": dom.lower(),
                     "space_id": space_id, "weight": 1})
    if rows:
        await client.table("filing_hints").upsert(
            rows, on_conflict="user_id,kind,value,space_id").execute()
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/agent/kb/test_kb_persistence.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/kb/persistence.py tests/agent/kb/test_kb_persistence.py
git commit -m "feat(kb): Supabase persistence for spaces, links, facts, hints"
```

---

### Task 6: Ingest orchestrator (extraction → resolve → file → persist)

**Files:**
- Create: `src/stewardai/agent/kb/ingest.py`
- Test: `tests/agent/kb/test_ingest.py`

**Interfaces:**
- Consumes: everything above; `@dataclass MeetingMeta(recurring_event_id: str | None, attendee_emails: list[str], title: str)`.
- Produces:
  - `@dataclass(frozen=True) MeetingMeta(recurring_event_id: str | None, attendee_emails: list[str], title: str)`
  - `async def ingest_meeting_kb(client, llm, *, user_id: str, meeting_id: str, transcript: list[str], meta: MeetingMeta) -> None`

- [ ] **Step 1: Write the failing tests**

```python
# tests/agent/kb/test_ingest.py
from unittest.mock import AsyncMock, patch

from stewardai.agent.kb.ingest import MeetingMeta, ingest_meeting_kb


def _llm_yielding(text):
    class _LLM:
        async def complete(self, messages, *, system=None, temperature=0.4):
            yield text
    return _LLM()


async def test_high_confidence_domain_files_into_existing_space():
    # filing_hints resolves the attendee domain to space s1 with strong weight.
    async def fake_hint_scores(client, *, user_id, attendee_emails, domains):
        return {"s1": 0.9}

    llm = _llm_yielding('{"entities":[{"kind":"company","name":"Acme","email":null}],'
                        '"tags":["pricing"],"facts":[{"kind":"decision","text":"D","source_line":1,"due":null}]}')
    client = object()
    with patch("stewardai.agent.kb.ingest.resolve_entities", AsyncMock(return_value=["e1"])), \
         patch("stewardai.agent.kb.ingest._hint_scores", side_effect=fake_hint_scores), \
         patch("stewardai.agent.kb.ingest.kbp") as kbp:
        kbp.create_space = AsyncMock(return_value="new")
        kbp.set_meeting_space = AsyncMock()
        kbp.link_meeting_entities = AsyncMock()
        kbp.set_meeting_tags = AsyncMock()
        kbp.insert_facts = AsyncMock(return_value=1)
        kbp.record_filing_hints = AsyncMock()
        await ingest_meeting_kb(client, llm, user_id="u1", meeting_id="m1",
                                transcript=["[a]: hi"],
                                meta=MeetingMeta(None, ["jane@acme.com"], "Acme sync"))
        kbp.set_meeting_space.assert_awaited_once()
        assert kbp.set_meeting_space.await_args.kwargs["space_id"] == "s1"
        assert kbp.set_meeting_space.await_args.kwargs["source"] == "auto"
        kbp.create_space.assert_not_awaited()
        kbp.insert_facts.assert_awaited_once()


async def test_new_thread_auto_creates_space_named_from_company():
    async def no_hints(client, *, user_id, attendee_emails, domains):
        return {}

    llm = _llm_yielding('{"entities":[{"kind":"company","name":"Globex","email":null}],'
                        '"tags":[],"facts":[]}')
    with patch("stewardai.agent.kb.ingest.resolve_entities", AsyncMock(return_value=["e1"])), \
         patch("stewardai.agent.kb.ingest._hint_scores", side_effect=no_hints), \
         patch("stewardai.agent.kb.ingest.kbp") as kbp:
        kbp.create_space = AsyncMock(return_value="s-new")
        kbp.set_meeting_space = AsyncMock()
        kbp.link_meeting_entities = AsyncMock()
        kbp.set_meeting_tags = AsyncMock()
        kbp.insert_facts = AsyncMock(return_value=0)
        kbp.record_filing_hints = AsyncMock()
        await ingest_meeting_kb(object(), llm, user_id="u1", meeting_id="m1",
                                transcript=["[a]: hi"],
                                meta=MeetingMeta(None, ["x@globex.io"], "Globex intro"))
        kbp.create_space.assert_awaited_once()
        assert kbp.create_space.await_args.kwargs["name"] == "Globex"
        assert kbp.set_meeting_space.await_args.kwargs["space_id"] == "s-new"
        assert kbp.set_meeting_space.await_args.kwargs["source"] == "auto_created"


async def test_low_confidence_leaves_meeting_unfiled_no_facts():
    async def no_hints(client, *, user_id, attendee_emails, domains):
        return {}

    llm = _llm_yielding('{"entities":[],"tags":[],"facts":[{"kind":"risk","text":"r","source_line":0,"due":null}]}')
    with patch("stewardai.agent.kb.ingest.resolve_entities", AsyncMock(return_value=[])), \
         patch("stewardai.agent.kb.ingest._hint_scores", side_effect=no_hints), \
         patch("stewardai.agent.kb.ingest.kbp") as kbp:
        kbp.create_space = AsyncMock()
        kbp.set_meeting_space = AsyncMock()
        kbp.link_meeting_entities = AsyncMock()
        kbp.set_meeting_tags = AsyncMock()
        kbp.insert_facts = AsyncMock(return_value=0)
        kbp.record_filing_hints = AsyncMock()
        await ingest_meeting_kb(object(), llm, user_id="u1", meeting_id="m1",
                                transcript=["[a]: hi"], meta=MeetingMeta(None, [], "Sync"))
        # no company + no hints -> unfiled: no space set, no facts, no hints recorded
        kbp.create_space.assert_not_awaited()
        assert kbp.set_meeting_space.await_args.kwargs["space_id"] is None
        assert kbp.set_meeting_space.await_args.kwargs["source"] == "unfiled"
        kbp.insert_facts.assert_not_awaited()
        kbp.record_filing_hints.assert_not_awaited()
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/agent/kb/test_ingest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stewardai.agent.kb.ingest'`.

- [ ] **Step 3: Implement**

```python
# src/stewardai/agent/kb/ingest.py
"""Orchestrate post-meeting KB ingestion: extract -> resolve entities -> decide
filing -> persist. Pure decisions live in filing.py; DB writes in persistence.py.
Best-effort: any failure is logged, never raised into the meeting teardown path.
"""
from __future__ import annotations

from dataclasses import dataclass

from stewardai.agent.kb import persistence as kbp
from stewardai.agent.kb.entities import resolve_entities
from stewardai.agent.kb.extraction import extract_entities_and_facts
from stewardai.agent.kb.filing import decide_filing, score_candidates
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.ingest")


@dataclass(frozen=True)
class MeetingMeta:
    recurring_event_id: str | None
    attendee_emails: list[str]
    title: str


def _domains(emails: list[str]) -> list[str]:
    out = []
    for e in emails:
        if "@" in e:
            d = e.split("@", 1)[1].strip().lower()
            if d:
                out.append(d)
    return sorted(set(out))


def _new_thread_name(extracted: dict) -> str | None:
    """Name a brand-new Space from a named company only.

    Deliberately does NOT fall back to the meeting title: filing every unmatched
    one-off by its title would spawn a Space per meeting. No company + no candidate
    -> the meeting stays unfiled (or 'suggested' if a weak candidate exists) and
    waits in the tray.
    """
    for ent in extracted.get("entities", []):
        if ent.get("kind") == "company" and (ent.get("name") or "").strip():
            return ent["name"].strip()
    return None


async def _hint_scores(client, *, user_id: str, attendee_emails: list[str], domains: list[str]) -> dict:
    """Aggregate filing_hints into {space_id: score in [0,1]}.

    Sum matched hint weights per space, normalized by the number of signals we
    looked up, so a space matched by both the domain and an attendee scores higher.
    """
    signals = [("attendee_email", e.lower()) for e in attendee_emails] + \
              [("domain", d) for d in domains]
    if not signals:
        return {}
    totals: dict[str, float] = {}
    for kind, value in signals:
        resp = await (
            client.table("filing_hints").select("space_id,weight")
            .eq("user_id", user_id).eq("kind", kind).eq("value", value).execute()
        )
        for row in resp.data or []:
            totals[row["space_id"]] = totals.get(row["space_id"], 0.0) + float(row["weight"])
    if not totals:
        return {}
    denom = float(len(signals))
    return {sid: min(1.0, w / denom) for sid, w in totals.items()}


async def _recurring_space_id(client, *, user_id: str, recurring_event_id: str | None) -> str | None:
    if not recurring_event_id:
        return None
    resp = await (
        client.table("meetings").select("space_id")
        .eq("user_id", user_id).eq("recurring_event_id", recurring_event_id).execute()
    )
    for row in resp.data or []:
        if row.get("space_id"):
            return row["space_id"]
    return None


async def ingest_meeting_kb(client, llm, *, user_id: str, meeting_id: str,
                            transcript: list[str], meta: MeetingMeta) -> None:
    try:
        extracted = await extract_entities_and_facts(llm, transcript)
        entity_ids = await resolve_entities(client, user_id=user_id, extracted=extracted["entities"])
        await kbp.link_meeting_entities(client, user_id=user_id, meeting_id=meeting_id, entity_ids=entity_ids)
        await kbp.set_meeting_tags(client, user_id=user_id, meeting_id=meeting_id, tags=extracted["tags"])

        domains = _domains(meta.attendee_emails)
        recurring = await _recurring_space_id(client, user_id=user_id,
                                              recurring_event_id=meta.recurring_event_id)
        scores = await _hint_scores(client, user_id=user_id,
                                    attendee_emails=meta.attendee_emails, domains=domains)
        candidates = score_candidates(hint_scores=scores)
        decision = decide_filing(recurring_space_id=recurring, candidates=candidates,
                                 new_thread_name=_new_thread_name(extracted))

        space_id = decision.space_id
        if decision.action == "auto_created" and decision.new_space_name:
            space_id = await kbp.create_space(client, user_id=user_id, name=decision.new_space_name)

        await kbp.set_meeting_space(client, user_id=user_id, meeting_id=meeting_id,
                                    space_id=space_id, confidence=decision.confidence,
                                    source=decision.action)

        if space_id:
            await kbp.insert_facts(client, user_id=user_id, space_id=space_id,
                                   meeting_id=meeting_id, facts=extracted["facts"])
            # Only reinforce hints when we actually committed to a space (not 'suggested').
            if decision.action in ("auto", "auto_created", "recurring"):
                await kbp.record_filing_hints(client, user_id=user_id, space_id=space_id,
                                              attendee_emails=meta.attendee_emails, domains=domains)
        _log.info("kb_ingested", meeting_id=meeting_id, action=decision.action,
                  space_id=space_id, facts=len(extracted["facts"]), entities=len(entity_ids))
    except Exception as exc:  # noqa: BLE001 - KB ingest must never break teardown
        _log.warning("kb_ingest_failed", meeting_id=meeting_id, error=str(exc))
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/agent/kb/test_ingest.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/kb/ingest.py tests/agent/kb/test_ingest.py
git commit -m "feat(kb): ingest orchestrator wiring extract->resolve->file->persist"
```

---

### Task 7: Wire ingestion into meeting teardown

**Files:**
- Modify: `src/stewardai/agent/meeting_runner.py` (in `MeetingSession.teardown()`, after the existing `extract_post_meeting_actions` call around `meeting_runner.py:804-824`)
- Test: `tests/agent/kb/test_teardown_wiring.py`

**Interfaces:**
- Consumes: `ingest_meeting_kb`, `MeetingMeta` (Task 6); the session's existing `self._client`, `self._llm`, resolved `user_id`, `meeting_uuid`, `teardown_transcript`, and meeting metadata already loaded in the session.
- Produces: a small helper `async def _ingest_kb(self, transcript: list[str]) -> None` on `MeetingSession` that builds `MeetingMeta` and calls `ingest_meeting_kb`, invoked from `teardown()`.

- [ ] **Step 1: Write the failing test**

Because `MeetingSession` is heavy to construct, test the helper in isolation via a lightweight stand-in object that has the same attributes the helper reads. First, implement the helper as a module-level function the method delegates to, so it is unit-testable:

```python
# tests/agent/kb/test_teardown_wiring.py
from unittest.mock import AsyncMock, patch

from stewardai.agent.kb.teardown import run_kb_ingest


async def test_run_kb_ingest_builds_meta_and_calls_ingest():
    with patch("stewardai.agent.kb.teardown.ingest_meeting_kb", AsyncMock()) as ing:
        await run_kb_ingest(
            client="C", llm="L", user_id="u1", meeting_id="m1",
            transcript=["[a]: hi"],
            recurring_event_id="rec-1", attendee_emails=["jane@acme.com"], title="Acme sync",
        )
        ing.assert_awaited_once()
        kwargs = ing.await_args.kwargs
        assert kwargs["meeting_id"] == "m1"
        assert kwargs["meta"].recurring_event_id == "rec-1"
        assert kwargs["meta"].attendee_emails == ["jane@acme.com"]


async def test_run_kb_ingest_skips_when_no_user_or_meeting():
    with patch("stewardai.agent.kb.teardown.ingest_meeting_kb", AsyncMock()) as ing:
        await run_kb_ingest(client="C", llm="L", user_id=None, meeting_id="m1",
                            transcript=["x"], recurring_event_id=None,
                            attendee_emails=[], title="t")
        ing.assert_not_awaited()
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/agent/kb/test_teardown_wiring.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stewardai.agent.kb.teardown'`.

- [ ] **Step 3: Implement the helper**

```python
# src/stewardai/agent/kb/teardown.py
"""Thin adapter called from MeetingSession.teardown() so the wiring is unit-testable."""
from __future__ import annotations

from stewardai.agent.kb.ingest import MeetingMeta, ingest_meeting_kb
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.teardown")


async def run_kb_ingest(*, client, llm, user_id: str | None, meeting_id: str | None,
                        transcript: list[str], recurring_event_id: str | None,
                        attendee_emails: list[str], title: str) -> None:
    if not user_id or not meeting_id or not transcript:
        _log.info("kb_ingest_skipped", have_user=bool(user_id), have_meeting=bool(meeting_id))
        return
    meta = MeetingMeta(recurring_event_id=recurring_event_id,
                       attendee_emails=attendee_emails or [], title=title or "")
    await ingest_meeting_kb(client, llm, user_id=user_id, meeting_id=meeting_id,
                            transcript=transcript, meta=meta)
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/agent/kb/test_teardown_wiring.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Call the helper from `teardown()`**

In `src/stewardai/agent/meeting_runner.py`, immediately after the existing post-meeting actions extraction block (around `:804-824`), add:

```python
            # --- Knowledge Base ingestion (best-effort; never blocks teardown) ---
            try:
                from stewardai.agent.kb.teardown import run_kb_ingest

                await run_kb_ingest(
                    client=self._client,
                    llm=self._llm,
                    user_id=self._user_id,
                    meeting_id=self._meeting_uuid,
                    transcript=teardown_transcript,
                    recurring_event_id=getattr(self, "_recurring_event_id", None),
                    attendee_emails=getattr(self, "_attendee_emails", []),
                    title=getattr(self, "_meeting_title", ""),
                )
            except Exception as exc:  # noqa: BLE001
                _log.warning("kb_ingest_wire_failed", error=str(exc))
```

Use the session's actual attribute names for the client, llm, resolved user id, meeting UUID, and the `teardown_transcript` snapshot (`meeting_runner.py:800`). If the session does not already hold `recurring_event_id`, `attendee_emails`, or `title`, resolve them from the `meetings` row in the same place the session resolves `keyterms`/`profile` (`_resolve_keyterms` at `meeting_runner.py:308`, `_resolve_profile` at `:331`) — mirror that read (`select("recurring_event_id,title")` on `meetings`; attendee emails are not stored structured today, so pass `[]` until Plan A2/B adds them).

- [ ] **Step 6: Run the full KB + agent suite**

Run: `python -m pytest tests/agent/kb/ -v && python -m pytest tests/agent/ -q`
Expected: all KB tests PASS; the pre-existing `tests/agent/` results are unchanged from before this plan (note: `tests/agent/test_multiplexer.py` fails locally with `ModuleNotFoundError: No module named 'livekit'` — that is an environment gap, not caused by this task).

- [ ] **Step 7: Commit**

```bash
git add src/stewardai/agent/kb/teardown.py tests/agent/kb/test_teardown_wiring.py src/stewardai/agent/meeting_runner.py
git commit -m "feat(kb): run KB ingestion from meeting teardown"
```

---

## Notes for the implementer

- **`tests/agent/kb/` needs no `__init__.py`** — pytest `rootdir` config (`pythonpath = [".", "src"]`) discovers test files directly; mirror the existing `tests/agent/` layout.
- **Attendee emails are not stored structured today** (only a flat `meetings.keyterms` blob). Plan A1 therefore passes `attendee_emails=[]` by default; domain/attendee filing signals become active once A2/B persist structured attendees. The filing code already degrades gracefully to `unfiled` with no signals — that is expected and tested (Task 6, `test_low_confidence_leaves_meeting_unfiled_no_facts`).
- **Confidence tuning** (`HIGH_CONFIDENCE`/`LOW_CONFIDENCE` in `filing.py`) is deliberately conservative; revisit against real meetings (spec open question).
- **Facts are append-only in A1.** The spec's "dedupe / update-status / supersede" roll-up is intentionally deferred: facts are raw, provenance-stamped observations; reconciliation happens when the L3 living brief regenerates from them (later plan). The `space_facts.superseded_by` column exists so that logic has somewhere to write, but A1 does not populate it.
- **"Suggested" = provisional filing.** A low-but-nonzero-confidence match files the meeting into the best-guess Space with `space_source='suggested'` (facts inserted there), but does NOT reinforce filing_hints. The A2 "Unfiled tray" therefore surfaces meetings where `space_source IN ('suggested','unfiled')` (or `space_id IS NULL`) for one-tap confirm/correct; on a correction A2 re-parents the meeting and its facts. Truly-unsignalled meetings get `space_source='unfiled'`, `space_id=NULL`, and no facts (nothing to attach them to until filed).
- **This plan is backend-only.** Viewing/correcting Spaces, the Unfiled tray, and cross-Space entity history are Plan A2 (portal). Indexing + Ask are Plan B.
