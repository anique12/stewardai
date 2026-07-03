# KB Plan B — Index (L1) + Ask (L2, RAG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed every meeting's content into pgvector at ingestion (L1), then answer free-form questions about a Space/entity/everything with a synthesized, source-cited answer via a Python "Ask" API the portal calls (L2).

**Architecture:** L1 runs inside the existing best-effort KB ingest (`ingest_meeting_kb`, meeting teardown): chunk transcript + summary + facts → embed via `litellm.aembedding` (`text-embedding-004`, 768-dim) → store rows in a new `kb_chunks` pgvector table (RLS own-row). L2 is a new FastAPI `POST /api/ask` on the existing `web.app` backend: verify the caller's Supabase JWT → embed the question → `match_kb_chunks` pgvector cosine RPC (user-scoped) → synthesize an answer with `[n]` citations via `litellm`. The Next.js portal gets an `/app/ask` page that calls this API with the user's Supabase access token and renders answers with citation links back to the source meetings.

**Tech Stack:** Python 3.11 / asyncio, `litellm` (Gemini), Supabase Postgres + `pgvector`, FastAPI, pytest; Next.js App Router (portal), TypeScript, Jest.

## Global Constraints

- **Single provider (Gemini).** Embeddings use `gemini/text-embedding-004` via `litellm.aembedding`; synthesis uses the existing `LiteLLMClient` (Gemini). No second embedding/LLM provider.
- **Embedding dimension is 768.** The pgvector column is `vector(768)`; changing the model later is a re-embed migration, not a code change here.
- **Every row carries `user_id`; the service-role key bypasses RLS, so code MUST re-filter by `user_id`.** Mirror the existing KB pattern (`agent/kb/persistence.py`). RLS own-row policy on every new table anyway (defense in depth).
- **L1 is best-effort and MUST NEVER raise into meeting teardown.** It runs inside `ingest_meeting_kb`, whose top-level `try/except` already swallows failures — keep any new failure paths inside that guard (log `kb_*` warning, return).
- **Provenance on every retrievable chunk.** Each `kb_chunks` row stores `meeting_id` and (where applicable) `source_seq`. Answers cite `[n]` → a `{meeting_id, source_seq}` provenance entry. No unsourced synthesis: the synthesis prompt instructs "answer only from context; if not present, say you don't have it."
- **Repo hygiene:** never `git add -A` (stage explicit paths only); never commit secrets (`.env*` is gitignored); commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; work in place (no worktree).
- **Migration numbering:** the next Supabase migration is `0010_` (0009 is the latest). Migrations are raw SQL under `portal/supabase/migrations/`, applied to the dev Supabase project (same one A1 used).
- **Deployment note (not a code task):** the portal (Vercel, HTTPS) reaches the Ask API on the CX33 box; that box needs TLS/a domain for the browser `fetch` to succeed cross-origin. Code and all tests here run locally without it. Flag this as the deploy dependency; do not attempt TLS setup in this plan.

---

## File Structure

**Backend — new files:**
- `portal/supabase/migrations/0010_kb_embeddings.sql` — `vector` extension, `kb_chunks` table + indexes + RLS + `match_kb_chunks` RPC.
- `src/stewardai/agent/kb/chunking.py` — pure `build_chunks()` (transcript windows + summary + facts → chunk dicts).
- `src/stewardai/agent/kb/embeddings.py` — `index_meeting_chunks()` (fetch summary, chunk, embed, delete+insert).
- `src/stewardai/agent/kb/retrieval.py` — `retrieve()` (embed query + RPC + user re-check).
- `src/stewardai/agent/kb/ask.py` — `answer_question()` (retrieve → synth prompt → LLM → answer + citations).
- `web/kb_auth.py` — `user_id_from_bearer()` (verify Supabase JWT → user id).
- Tests: `tests/agent/kb/test_chunking.py`, `test_embeddings.py`, `test_retrieval.py`, `test_ask.py`, `tests/web/test_ask_api.py`.

**Backend — modified files:**
- `src/stewardai/llm/litellm_client.py` — add `aembed()`.
- `src/stewardai/config.py` — add `embedding_model`, `embedding_dim`, `ask_top_k`, `ask_cors_origins`.
- `src/stewardai/agent/kb/ingest.py` — call `index_meeting_chunks()` after filing.
- `web/app.py` — build a shared Supabase service client in lifespan; add `POST /api/ask` + CORS.

**Portal — new files:**
- `portal/src/lib/ask/client.ts` — typed `askQuestion()` fetch wrapper + `renderCitations` pure helper.
- `portal/src/lib/ask/client.test.ts` — Jest tests for the pure helper + fetch wrapper.
- `portal/src/components/ask/AskPanel.tsx` — client component (input, answer, citation links).
- `portal/src/app/app/ask/page.tsx` — the Ask view.

**Portal — modified files:**
- `portal/src/components/app-shell/Sidebar.tsx` — add "Ask" nav item.

---

## Interfaces (contract shared across tasks)

```text
# T2 produces
LiteLLMClient.aembed(texts: list[str], *, query: bool = False) -> list[list[float]]
    # query=False → RETRIEVAL_DOCUMENT (index side); query=True → RETRIEVAL_QUERY.
    # Returns one 768-float vector per input, order-preserving.

# T3 produces  (chunk dict shape used by T4)
build_chunks(transcript: list[str], summary_tldr: str | None, facts: list[dict]) -> list[dict]
    # each chunk: {"kind": "segment"|"summary"|"fact", "text": str, "source_seq": int | None}

# T4 produces
index_meeting_chunks(client, llm, *, user_id: str, space_id: str | None,
                     meeting_id: str, transcript: list[str], facts: list[dict]) -> int
    # returns number of chunks written; deletes existing kb_chunks for meeting first (idempotent)

# T5 produces  (retrieved row shape used by T6)
retrieve(client, llm, *, user_id: str, query: str, space_id: str | None = None,
         k: int = 8) -> list[dict]
    # each row: {"text": str, "meeting_id": str, "source_seq": int | None,
    #            "kind": str, "similarity": float}

# T6 produces  (Ask result shape used by T7 + portal)
answer_question(client, llm, *, user_id: str, query: str,
                space_id: str | None = None) -> dict
    # {"answer": str, "citations": [{"n": int, "meeting_id": str,
    #    "source_seq": int | None, "kind": str, "snippet": str}]}

# T7 produces
POST /api/ask   Authorization: Bearer <supabase access_token>
    body:  {"query": str, "space_id": str | null}
    200:   {"answer": str, "citations": [...]}   (same shape as answer_question)
    401:   {"error": "unauthorized"}

# T1 produces (SQL RPC; called by T5)
match_kb_chunks(p_user_id uuid, query_embedding text, match_count int, p_space_id uuid)
    returns table(text text, meeting_id uuid, source_seq int, kind text, similarity float)
    # query_embedding is a JSON-array string cast to ::vector inside the function
```

---

### Task 1: Migration 0010 — pgvector table + retrieval RPC

**Files:**
- Create: `portal/supabase/migrations/0010_kb_embeddings.sql`

**Interfaces:**
- Produces: the `kb_chunks` table and `match_kb_chunks(...)` RPC (signature in the Interfaces block). Consumed by T4 (insert) and T5 (rpc call).

- [ ] **Step 1: Write the migration SQL**

Create `portal/supabase/migrations/0010_kb_embeddings.sql`:

```sql
-- 0010_kb_embeddings.sql — KB L1/L2: pgvector chunk store + cosine retrieval RPC.

create extension if not exists vector;

-- One embeddable chunk of a meeting: a transcript window, the summary, or a fact.
-- space_id is NULLABLE so unfiled meetings are still searchable (globally / by meeting).
create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  kind text not null check (kind in ('segment','summary','fact')),
  source_seq integer,                 -- transcript index for provenance (null for summary)
  text text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);
create index if not exists kb_chunks_user_space_idx on public.kb_chunks (user_id, space_id);
create index if not exists kb_chunks_meeting_idx on public.kb_chunks (meeting_id);
-- Cosine ANN index. Lists=100 is fine at single-user scale; revisit if the table grows large.
create index if not exists kb_chunks_embedding_idx on public.kb_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- RLS own-row (service-role bypasses; code re-filters by user_id anyway).
alter table public.kb_chunks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename='kb_chunks' and policyname='kb_chunks_own') then
    create policy kb_chunks_own on public.kb_chunks for all
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- Cosine top-k retrieval, user-scoped, optionally filtered to one Space.
-- query_embedding arrives as a JSON-array string and is cast to ::vector here, which
-- avoids PostgREST's vector-serialization pitfalls when passing an array RPC arg.
create or replace function public.match_kb_chunks(
  p_user_id uuid,
  query_embedding text,
  match_count int default 8,
  p_space_id uuid default null
)
returns table (
  text text,
  meeting_id uuid,
  source_seq int,
  kind text,
  similarity float
)
language sql stable
as $$
  select c.text, c.meeting_id, c.source_seq, c.kind,
         1 - (c.embedding <=> (query_embedding::vector)) as similarity
  from public.kb_chunks c
  where c.user_id = p_user_id
    and (p_space_id is null or c.space_id = p_space_id)
  order by c.embedding <=> (query_embedding::vector)
  limit match_count;
$$;
```

- [ ] **Step 2: Apply the migration to the dev Supabase project**

Apply `0010_kb_embeddings.sql` against the same dev Supabase project A1/A2 used (SQL editor or `supabase db push`, whichever the repo uses for `0009`). Confirm no error and the `vector` extension enabled.

- [ ] **Step 3: Smoke-test the schema + RPC**

In the Supabase SQL editor, verify the table and RPC exist and the RPC runs (using a zero vector string):

```sql
select count(*) from public.kb_chunks;                       -- expect 0
select * from public.match_kb_chunks(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '[' || rtrim(repeat('0,', 768), ',') || ']',               -- 768-zero vector as text
  8, null);                                                    -- expect 0 rows, no error
```
Expected: both run without error (first returns 0; second returns an empty set).

- [ ] **Step 4: Commit**

```bash
git add portal/supabase/migrations/0010_kb_embeddings.sql
git commit -m "feat(kb): 0010 pgvector kb_chunks table + match_kb_chunks retrieval RPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `aembed()` on the LiteLLM client + embedding config

**Files:**
- Modify: `src/stewardai/config.py` (add settings near the existing Gemini fields ~line 72)
- Modify: `src/stewardai/llm/litellm_client.py` (add method on `LiteLLMClient`)
- Test: `tests/agent/kb/test_embeddings.py` (new file; the `aembed` test lives here alongside T4's tests)

**Interfaces:**
- Produces: `LiteLLMClient.aembed(texts, *, query=False) -> list[list[float]]` (see Interfaces block). Consumed by T4 (index) and T5 (query).

- [ ] **Step 1: Write the failing test**

Create `tests/agent/kb/test_embeddings.py`:

```python
# tests/agent/kb/test_embeddings.py
import litellm

from stewardai.llm.litellm_client import LiteLLMClient


async def test_aembed_returns_one_vector_per_input_and_sets_task_type(monkeypatch):
    seen = {}

    async def fake_aembedding(*, model, input, **kwargs):
        seen["model"] = model
        seen["input"] = input
        seen["kwargs"] = kwargs

        class _R:
            data = [{"embedding": [0.1] * 768} for _ in input]

        return _R()

    monkeypatch.setattr(litellm, "aembedding", fake_aembedding)
    client = LiteLLMClient()

    docs = await client.aembed(["a", "b"], query=False)
    assert len(docs) == 2 and len(docs[0]) == 768
    assert "text-embedding-004" in seen["model"]
    assert seen["kwargs"].get("task_type") == "RETRIEVAL_DOCUMENT"

    await client.aembed(["q"], query=True)
    assert seen["kwargs"].get("task_type") == "RETRIEVAL_QUERY"


async def test_aembed_empty_input_returns_empty(monkeypatch):
    async def fake_aembedding(*, model, input, **kwargs):  # pragma: no cover - must not be called
        raise AssertionError("aembedding should not be called for empty input")

    monkeypatch.setattr(litellm, "aembedding", fake_aembedding)
    client = LiteLLMClient()
    assert await client.aembed([]) == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/agent/kb/test_embeddings.py -v`
Expected: FAIL with `AttributeError: 'LiteLLMClient' object has no attribute 'aembed'`.

- [ ] **Step 3: Add the config settings**

In `src/stewardai/config.py`, add near the existing Gemini fields (after `llm_model` ~line 74):

```python
    # KB embeddings (Plan B): single-provider Gemini embedding model, 768-dim.
    embedding_model: str = "gemini/text-embedding-004"
    embedding_dim: int = 768
    # Ask (RAG) retrieval depth + allowed browser origins for the /api/ask endpoint.
    ask_top_k: int = 8
    ask_cors_origins: str = ""  # comma-separated portal origins; empty = no CORS added
```

- [ ] **Step 4: Add the `aembed` method**

In `src/stewardai/llm/litellm_client.py`, add this method to `LiteLLMClient` (e.g. after `aclose`):

```python
    async def aembed(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        """Embed texts with the configured Gemini embedding model (768-dim).

        Asymmetric task types improve retrieval: index side embeds as
        RETRIEVAL_DOCUMENT, the query side as RETRIEVAL_QUERY. Order-preserving:
        the i-th vector corresponds to the i-th input.
        """
        if not texts:
            return []
        import litellm  # lazy

        task_type = "RETRIEVAL_QUERY" if query else "RETRIEVAL_DOCUMENT"
        resp = await litellm.aembedding(
            model=self._s.embedding_model,
            input=texts,
            task_type=task_type,
            timeout=self._s.llm_timeout_s,
        )
        # litellm normalizes to an OpenAI-shaped response: resp.data[i]["embedding"].
        return [row["embedding"] for row in resp.data]
```

Note for the implementer: if a live Gemini call later rejects `task_type` (verify on the box), it is safe to drop the kwarg — symmetric embedding still works for v1. The unit test asserts the kwarg is passed; keep it unless a live failure proves otherwise, and if you drop it, update the test in the same commit.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pytest tests/agent/kb/test_embeddings.py -v`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/stewardai/config.py src/stewardai/llm/litellm_client.py tests/agent/kb/test_embeddings.py
git commit -m "feat(kb): LiteLLMClient.aembed + embedding/Ask settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `chunking.py` — pure chunk builder

**Files:**
- Create: `src/stewardai/agent/kb/chunking.py`
- Test: `tests/agent/kb/test_chunking.py`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `build_chunks(transcript, summary_tldr, facts) -> list[dict]` (see Interfaces block). Consumed by T4.

- [ ] **Step 1: Write the failing test**

Create `tests/agent/kb/test_chunking.py`:

```python
# tests/agent/kb/test_chunking.py
from stewardai.agent.kb.chunking import build_chunks


def test_summary_and_facts_become_chunks_with_provenance():
    chunks = build_chunks(
        transcript=[],
        summary_tldr="We agreed to ship Friday.",
        facts=[
            {"kind": "decision", "text": "Ship Friday", "source_line": 3},
            {"kind": "risk", "text": "Vendor may slip", "source_line": None},
            {"kind": "bogus", "text": "ignored", "source_line": 1},  # invalid kind → skipped
            {"kind": "date", "text": "", "source_line": 2},          # empty text → skipped
        ],
    )
    kinds = [(c["kind"], c["text"], c["source_seq"]) for c in chunks]
    assert ("summary", "We agreed to ship Friday.", None) in kinds
    assert ("fact", "Ship Friday", 3) in kinds
    assert ("fact", "Vendor may slip", None) in kinds
    assert all(c["text"] for c in chunks)                 # no empty-text chunks
    assert not any(c["text"] == "ignored" for c in chunks)  # invalid kind dropped


def test_transcript_windows_group_consecutive_lines_and_carry_first_seq():
    # Lines long enough that ~1500-char windows split into two groups.
    transcript = [("x" * 400) for _ in range(8)]  # 8 * ~401 chars ≈ 3200 chars
    chunks = [c for c in build_chunks(transcript, None, []) if c["kind"] == "segment"]
    assert len(chunks) >= 2                 # split into multiple windows
    assert chunks[0]["source_seq"] == 0     # first window starts at line 0
    assert chunks[1]["source_seq"] > 0      # second window starts later
    assert all(len(c["text"]) <= 1600 for c in chunks)  # windows respect the cap (+ one overflow line)


def test_empty_inputs_yield_no_chunks():
    assert build_chunks([], None, []) == []
    assert build_chunks([], "", []) == []   # empty summary string is not a chunk
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/agent/kb/test_chunking.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'stewardai.agent.kb.chunking'`.

- [ ] **Step 3: Write the implementation**

Create `src/stewardai/agent/kb/chunking.py`:

```python
# src/stewardai/agent/kb/chunking.py
"""Pure: turn a meeting's transcript + summary + facts into embeddable chunks.

Each chunk is a small dict {kind, text, source_seq}. Transcript lines are grouped
into ~1500-char windows so we embed coherent passages (not one utterance each),
bounding embedding cost while keeping provenance (source_seq = the window's first
transcript index). Summary and facts become their own chunks. No I/O, no LLM.
"""
from __future__ import annotations

_WINDOW_CHARS = 1500
_FACT_KINDS = frozenset({"action_item", "decision", "date", "risk", "open_question"})


def _transcript_windows(transcript: list[str]) -> list[dict]:
    out: list[dict] = []
    buf: list[str] = []
    start = 0
    size = 0
    for i, line in enumerate(transcript):
        line = (line or "").strip()
        if not line:
            continue
        if buf and size + len(line) > _WINDOW_CHARS:
            out.append({"kind": "segment", "text": "\n".join(buf), "source_seq": start})
            buf, size, start = [], 0, i
        if not buf:
            start = i
        buf.append(line)
        size += len(line)
    if buf:
        out.append({"kind": "segment", "text": "\n".join(buf), "source_seq": start})
    return out


def _coerce_seq(value) -> int | None:  # noqa: ANN001
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def build_chunks(transcript: list[str], summary_tldr: str | None,
                 facts: list[dict]) -> list[dict]:
    chunks: list[dict] = list(_transcript_windows(transcript or []))
    if summary_tldr and summary_tldr.strip():
        chunks.append({"kind": "summary", "text": summary_tldr.strip(), "source_seq": None})
    for f in facts or []:
        if f.get("kind") in _FACT_KINDS and (f.get("text") or "").strip():
            chunks.append({
                "kind": "fact",
                "text": f["text"].strip(),
                "source_seq": _coerce_seq(f.get("source_line")),
            })
    return chunks
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/agent/kb/test_chunking.py -v`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/kb/chunking.py tests/agent/kb/test_chunking.py
git commit -m "feat(kb): pure chunk builder (transcript windows + summary + facts)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `embeddings.py` — index a meeting's chunks + wire into ingest

**Files:**
- Create: `src/stewardai/agent/kb/embeddings.py`
- Modify: `src/stewardai/agent/kb/ingest.py` (call `index_meeting_chunks` after `set_meeting_space`)
- Test: append to `tests/agent/kb/test_embeddings.py`

**Interfaces:**
- Consumes: `LiteLLMClient.aembed` (T2), `build_chunks` (T3), the `kb_chunks` table (T1).
- Produces: `index_meeting_chunks(client, llm, *, user_id, space_id, meeting_id, transcript, facts) -> int` (see Interfaces block).

- [ ] **Step 1: Write the failing test**

Append to `tests/agent/kb/test_embeddings.py`:

```python
from stewardai.agent.kb.embeddings import index_meeting_chunks


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, log, table):
        self._log, self._t, self._op, self._payload = log, table, None, None

    def select(self, *_a):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, *_a):
        return self

    async def execute(self):
        self._log.append({"table": self._t, "op": self._op, "payload": self._payload})
        if self._t == "summaries" and self._op == "select":
            return _Resp([{"tldr": "Shipped the thing."}])
        return _Resp([])


class _Client:
    def __init__(self):
        self.calls = []

    def table(self, name):
        return _Query(self.calls, name)


class _LLM:
    def __init__(self):
        self.embedded = None

    async def aembed(self, texts, *, query=False):
        self.embedded = list(texts)
        return [[0.0] * 768 for _ in texts]


def _ops(client, table, op):
    return [c["payload"] for c in client.calls if c["table"] == table and c["op"] == op]


async def test_index_meeting_chunks_deletes_then_inserts_with_embeddings():
    c, llm = _Client(), _LLM()
    n = await index_meeting_chunks(
        c, llm, user_id="u1", space_id="s1", meeting_id="m1",
        transcript=["Alice: hi", "Bob: we ship Friday"],
        facts=[{"kind": "decision", "text": "Ship Friday", "source_line": 1}],
    )
    assert n >= 3  # >=1 transcript window + summary + 1 fact
    # idempotent: existing rows for the meeting are deleted before insert
    assert _ops(c, "kb_chunks", "delete") != []
    rows = _ops(c, "kb_chunks", "insert")[0]
    assert all(r["user_id"] == "u1" and r["meeting_id"] == "m1" for r in rows)
    assert all(len(r["embedding"]) == 768 for r in rows)
    assert any(r["kind"] == "summary" and r["text"] == "Shipped the thing." for r in rows)
    assert any(r["kind"] == "fact" and r["source_seq"] == 1 for r in rows)


async def test_index_meeting_chunks_noop_when_nothing_to_embed():
    c, llm = _Client(), _LLM()
    # empty transcript + no facts; summary lookup returns rows but we force empty below
    async def _empty_execute():
        return _Resp([])
    # Patch summaries lookup to return no tldr by using a client with no summary row:
    class _EmptyQuery(_Query):
        async def execute(self):
            self._log.append({"table": self._t, "op": self._op, "payload": self._payload})
            return _Resp([])

    class _EmptyClient(_Client):
        def table(self, name):
            return _EmptyQuery(self.calls, name)

    ec = _EmptyClient()
    n = await index_meeting_chunks(ec, llm, user_id="u1", space_id=None,
                                   meeting_id="m1", transcript=[], facts=[])
    assert n == 0
    assert _ops(ec, "kb_chunks", "insert") == []  # nothing inserted
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/agent/kb/test_embeddings.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'stewardai.agent.kb.embeddings'`.

- [ ] **Step 3: Write the implementation**

Create `src/stewardai/agent/kb/embeddings.py`:

```python
# src/stewardai/agent/kb/embeddings.py
"""Embed a meeting's chunks into kb_chunks (L1). Best-effort: callers run this
inside ingest_meeting_kb's try/except, so a failure here never breaks teardown.

Idempotent: existing kb_chunks for the meeting are deleted before re-insert, so a
re-ingest replaces cleanly. space_id may be None (unfiled meeting) — still indexed.
"""
from __future__ import annotations

from stewardai.agent.kb.chunking import build_chunks
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.embeddings")


async def _fetch_summary_tldr(client, *, user_id: str, meeting_id: str) -> str | None:
    resp = await (
        client.table("summaries").select("tldr")
        .eq("meeting_id", meeting_id).execute()
    )
    for row in resp.data or []:
        if row.get("tldr"):
            return row["tldr"]
    return None


async def index_meeting_chunks(client, llm, *, user_id: str, space_id: str | None,
                               meeting_id: str, transcript: list[str],
                               facts: list[dict]) -> int:
    summary_tldr = await _fetch_summary_tldr(client, user_id=user_id, meeting_id=meeting_id)
    chunks = build_chunks(transcript, summary_tldr, facts)
    if not chunks:
        _log.info("kb_index_skipped", meeting_id=meeting_id, reason="no_chunks")
        return 0

    vectors = await llm.aembed([c["text"] for c in chunks], query=False)
    if len(vectors) != len(chunks):
        _log.warning("kb_index_embed_mismatch", meeting_id=meeting_id,
                     chunks=len(chunks), vectors=len(vectors))
        return 0

    rows = [{
        "user_id": user_id, "space_id": space_id, "meeting_id": meeting_id,
        "kind": c["kind"], "source_seq": c["source_seq"], "text": c["text"],
        "embedding": vec,
    } for c, vec in zip(chunks, vectors)]

    # Idempotent replace: drop any prior chunks for this meeting, then insert.
    await client.table("kb_chunks").delete().eq("meeting_id", meeting_id).eq(
        "user_id", user_id).execute()
    await client.table("kb_chunks").insert(rows).execute()
    _log.info("kb_indexed", meeting_id=meeting_id, chunks=len(rows), space_id=space_id)
    return len(rows)
```

- [ ] **Step 4: Wire into ingest**

In `src/stewardai/agent/kb/ingest.py`, add the import at the top with the other kb imports:

```python
from stewardai.agent.kb.embeddings import index_meeting_chunks
```

Then, inside `ingest_meeting_kb`, after the `set_meeting_space(...)` call and its `if space_id:` fact block (after line ~118, still inside the `try`), add:

```python
        # L1: embed this meeting's content for Ask/RAG. Runs even when unfiled
        # (space_id is None) so the meeting is still searchable globally.
        await index_meeting_chunks(client, llm, user_id=user_id, space_id=space_id,
                                   meeting_id=meeting_id, transcript=transcript,
                                   facts=extracted["facts"])
```

(The enclosing `try/except Exception` already guarantees an embedding failure only logs `kb_ingest_failed` and never raises into teardown.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/agent/kb/test_embeddings.py tests/agent/kb/test_ingest.py -v`
Expected: PASS. (`test_ingest.py` must still pass — its fake client/llm now also receives the `index_meeting_chunks` calls; if the existing fake LLM lacks `aembed`, add a no-op `aembed` to that test's fake in the same commit, mirroring the T4 `_LLM` fake.)

- [ ] **Step 6: Commit**

```bash
git add src/stewardai/agent/kb/embeddings.py src/stewardai/agent/kb/ingest.py tests/agent/kb/test_embeddings.py tests/agent/kb/test_ingest.py
git commit -m "feat(kb): index meeting chunks into pgvector at ingestion (L1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `retrieval.py` — embed query + pgvector RPC

**Files:**
- Create: `src/stewardai/agent/kb/retrieval.py`
- Test: `tests/agent/kb/test_retrieval.py`

**Interfaces:**
- Consumes: `LiteLLMClient.aembed` (T2, `query=True`), the `match_kb_chunks` RPC (T1).
- Produces: `retrieve(client, llm, *, user_id, query, space_id=None, k=8) -> list[dict]` (see Interfaces block). Consumed by T6.

- [ ] **Step 1: Write the failing test**

Create `tests/agent/kb/test_retrieval.py`:

```python
# tests/agent/kb/test_retrieval.py
import json

from stewardai.agent.kb.retrieval import retrieve


class _Resp:
    def __init__(self, data):
        self.data = data


class _RPC:
    def __init__(self, log, name, params):
        self._log, self._name, self._params = log, name, params

    async def execute(self):
        self._log.append({"rpc": self._name, "params": self._params})
        return _Resp([
            {"text": "we ship Friday", "meeting_id": "m1", "source_seq": 3,
             "kind": "segment", "similarity": 0.91},
        ])


class _Client:
    def __init__(self):
        self.calls = []

    def rpc(self, name, params):
        return _RPC(self.calls, name, params)


class _LLM:
    async def aembed(self, texts, *, query=False):
        assert query is True  # retrieval must use the QUERY task type
        return [[0.25] * 768 for _ in texts]


async def test_retrieve_embeds_query_and_calls_rpc_scoped_to_user():
    c, llm = _Client(), _LLM()
    rows = await retrieve(c, llm, user_id="u1", query="when do we ship?",
                          space_id="s1", k=5)
    assert rows and rows[0]["meeting_id"] == "m1"
    call = c.calls[0]
    assert call["rpc"] == "match_kb_chunks"
    assert call["params"]["p_user_id"] == "u1"
    assert call["params"]["p_space_id"] == "s1"
    assert call["params"]["match_count"] == 5
    # embedding passed as a JSON-array string (cast to ::vector in SQL)
    assert isinstance(call["params"]["query_embedding"], str)
    assert len(json.loads(call["params"]["query_embedding"])) == 768


async def test_retrieve_empty_query_returns_empty_without_calling_rpc():
    c, llm = _Client(), _LLM()
    assert await retrieve(c, llm, user_id="u1", query="   ") == []
    assert c.calls == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/agent/kb/test_retrieval.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'stewardai.agent.kb.retrieval'`.

- [ ] **Step 3: Write the implementation**

Create `src/stewardai/agent/kb/retrieval.py`:

```python
# src/stewardai/agent/kb/retrieval.py
"""L2 retrieval: embed the question, cosine top-k via the match_kb_chunks RPC.

User-scoped (RPC filters p_user_id; service-role bypasses RLS so this is the real
tenant boundary). Optionally scoped to one Space. Returns rows with provenance.
"""
from __future__ import annotations

import json

from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.retrieval")


async def retrieve(client, llm, *, user_id: str, query: str,
                   space_id: str | None = None, k: int = 8) -> list[dict]:
    if not query or not query.strip():
        return []
    vectors = await llm.aembed([query.strip()], query=True)
    if not vectors:
        return []
    resp = await client.rpc("match_kb_chunks", {
        "p_user_id": user_id,
        "query_embedding": json.dumps(vectors[0]),  # array-as-text → ::vector in SQL
        "match_count": k,
        "p_space_id": space_id,
    }).execute()
    rows = resp.data or []
    _log.info("kb_retrieved", user_id=user_id, space_id=space_id, hits=len(rows))
    return rows
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/agent/kb/test_retrieval.py -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/kb/retrieval.py tests/agent/kb/test_retrieval.py
git commit -m "feat(kb): L2 retrieval (embed query + match_kb_chunks RPC)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `ask.py` — synthesize a cited answer

**Files:**
- Create: `src/stewardai/agent/kb/ask.py`
- Test: `tests/agent/kb/test_ask.py`

**Interfaces:**
- Consumes: `retrieve` (T5), `LiteLLMClient.complete` (existing; streams text — collect it).
- Produces: `answer_question(client, llm, *, user_id, query, space_id=None) -> dict` (see Interfaces block). Consumed by T7 and the portal.

- [ ] **Step 1: Write the failing test**

Create `tests/agent/kb/test_ask.py`:

```python
# tests/agent/kb/test_ask.py
import stewardai.agent.kb.ask as ask_mod
from stewardai.agent.kb.ask import answer_question


class _LLM:
    def __init__(self):
        self.system = None
        self.messages = None

    async def complete(self, messages, *, system=None, temperature=0.4):
        self.system = system
        self.messages = messages
        for token in ["We ship ", "Friday [1]."]:
            yield token


async def test_answer_question_builds_context_and_returns_citations(monkeypatch):
    async def fake_retrieve(client, llm, *, user_id, query, space_id=None, k=8):
        return [
            {"text": "we ship Friday", "meeting_id": "m1", "source_seq": 3,
             "kind": "segment", "similarity": 0.9},
            {"text": "Ship Friday", "meeting_id": "m1", "source_seq": 1,
             "kind": "fact", "similarity": 0.8},
        ]

    monkeypatch.setattr(ask_mod, "retrieve", fake_retrieve)
    llm = _LLM()
    out = await answer_question(llm and object(), llm, user_id="u1",
                                query="when do we ship?")
    assert out["answer"] == "We ship Friday [1]."
    assert [c["n"] for c in out["citations"]] == [1, 2]
    assert out["citations"][0]["meeting_id"] == "m1"
    assert out["citations"][0]["source_seq"] == 3
    # the numbered context reached the model
    assert "[1]" in llm.messages[-1].content and "we ship Friday" in llm.messages[-1].content


async def test_answer_question_no_hits_returns_dont_know_without_calling_llm(monkeypatch):
    async def fake_retrieve(*a, **k):
        return []

    called = {"llm": False}

    class _NoLLM:
        async def complete(self, *a, **k):  # pragma: no cover - must not run
            called["llm"] = True
            yield ""

    monkeypatch.setattr(ask_mod, "retrieve", fake_retrieve)
    out = await answer_question(object(), _NoLLM(), user_id="u1", query="anything?")
    assert out["citations"] == []
    assert "don't have" in out["answer"].lower() or "no" in out["answer"].lower()
    assert called["llm"] is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/agent/kb/test_ask.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'stewardai.agent.kb.ask'`.

- [ ] **Step 3: Write the implementation**

Create `src/stewardai/agent/kb/ask.py`:

```python
# src/stewardai/agent/kb/ask.py
"""L2 Ask: retrieve → synthesize a source-cited answer. Answers ONLY from the
retrieved context; if the context lacks the answer, says so (no fabrication).
"""
from __future__ import annotations

from stewardai.agent.kb.retrieval import retrieve
from stewardai.common.audio import Message
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.ask")

_NO_CONTEXT = (
    "I don't have anything in your knowledge base about that yet."
)

_SYSTEM = (
    "You are Steward, answering the user's question about their meetings and work. "
    "Use ONLY the numbered context below. Cite the sources you use with [n] markers "
    "that match the context numbers. If the context does not contain the answer, say "
    "you don't have that information — do not guess. Be concise."
)


def _snippet(text: str, limit: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def answer_question(client, llm, *, user_id: str, query: str,
                          space_id: str | None = None) -> dict:
    rows = await retrieve(client, llm, user_id=user_id, query=query, space_id=space_id)
    if not rows:
        return {"answer": _NO_CONTEXT, "citations": []}

    citations = [{
        "n": i + 1,
        "meeting_id": r.get("meeting_id"),
        "source_seq": r.get("source_seq"),
        "kind": r.get("kind"),
        "snippet": _snippet(r.get("text", "")),
    } for i, r in enumerate(rows)]

    context = "\n".join(f"[{c['n']}] {r.get('text', '')}" for c, r in zip(citations, rows))
    user_msg = f"Question: {query}\n\nContext:\n{context}"

    parts: list[str] = []
    async for token in llm.complete([Message(role="user", content=user_msg)],
                                    system=_SYSTEM, temperature=0.2):
        parts.append(token)
    answer = "".join(parts).strip()
    _log.info("kb_ask_answered", user_id=user_id, space_id=space_id,
              hits=len(rows), chars=len(answer))
    return {"answer": answer, "citations": citations}
```

Note: confirm `Message` is importable from `stewardai.common.audio` (it is used by `litellm_client.complete`). If its location differs, match the import used in `src/stewardai/llm/litellm_client.py`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/agent/kb/test_ask.py -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/kb/ask.py tests/agent/kb/test_ask.py
git commit -m "feat(kb): L2 Ask — synthesize a source-cited answer over retrieved chunks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `POST /api/ask` FastAPI endpoint + Supabase JWT auth + CORS

**Files:**
- Create: `web/kb_auth.py`
- Modify: `web/app.py` (build shared Supabase client in lifespan; add CORS; add `POST /api/ask`)
- Test: `tests/web/test_ask_api.py`

**Interfaces:**
- Consumes: `answer_question` (T6), `create_service_client` (`stewardai.integrations.supabase_client`), `app.state.llm` (existing).
- Produces: `POST /api/ask` (see Interfaces block). Consumed by the portal (T8).

- [ ] **Step 1: Write the failing test**

Create `tests/web/test_ask_api.py`:

```python
# tests/web/test_ask_api.py
import web.app as webapp
from fastapi.testclient import TestClient


def _client(monkeypatch, *, user_id, answer):
    async def fake_user_id_from_bearer(authorization, client):
        return user_id

    async def fake_answer_question(client, llm, *, user_id, query, space_id=None):
        return answer

    monkeypatch.setattr(webapp, "user_id_from_bearer", fake_user_id_from_bearer)
    monkeypatch.setattr(webapp, "answer_question", fake_answer_question)
    app = webapp.app
    app.state.llm = object()
    app.state.supabase = object()
    return TestClient(app)


def test_ask_returns_answer_for_valid_token(monkeypatch):
    payload = {"answer": "We ship Friday [1].",
               "citations": [{"n": 1, "meeting_id": "m1", "source_seq": 3,
                              "kind": "segment", "snippet": "we ship Friday"}]}
    client = _client(monkeypatch, user_id="u1", answer=payload)
    r = client.post("/api/ask", json={"query": "when?", "space_id": None},
                    headers={"Authorization": "Bearer good"})
    assert r.status_code == 200
    assert r.json()["answer"] == "We ship Friday [1]."


def test_ask_rejects_missing_or_invalid_token(monkeypatch):
    client = _client(monkeypatch, user_id=None, answer={})
    r = client.post("/api/ask", json={"query": "when?"})
    assert r.status_code == 401
```

Note: use `TestClient` from `fastapi.testclient` (sync context manager not required for a simple POST). If the app's `lifespan` warmup makes plain `TestClient(app)` construction do heavy work, construct the client without entering the context manager (as above, `TestClient(app)` does not trigger lifespan unless used as a `with` block) — the test monkeypatches the two functions the route calls, so no backends are needed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/web/test_ask_api.py -v`
Expected: FAIL (route `/api/ask` returns 404, or import error for `user_id_from_bearer`).

- [ ] **Step 3: Write the auth helper**

Create `web/kb_auth.py`:

```python
# web/kb_auth.py
"""Verify a Supabase access token (Bearer) and return the user id, or None.

Uses the Supabase auth server to validate the JWT (no local secret needed): the
async client's auth.get_user(jwt) round-trips to GoTrue and returns the user.
"""
from __future__ import annotations

from contextlib import suppress

from stewardai.common.logging import get_logger

_log = get_logger("web.kb_auth")


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


async def user_id_from_bearer(authorization: str | None, client) -> str | None:
    token = _bearer(authorization)
    if not token:
        return None
    with suppress(Exception):
        resp = await client.auth.get_user(token)
        user = getattr(resp, "user", None)
        if user is not None and getattr(user, "id", None):
            return user.id
    _log.info("ask_auth_rejected")
    return None
```

- [ ] **Step 4: Wire the route + CORS + shared client into `web/app.py`**

Add imports near the top of `web/app.py`:

```python
from fastapi.middleware.cors import CORSMiddleware

from stewardai.agent.kb.ask import answer_question
from stewardai.integrations.supabase_client import create_service_client

from .kb_auth import user_id_from_bearer
```

In `lifespan`, after `app.state.llm = make_llm(settings)`, build a shared Supabase client (best-effort — Ask is optional; other pages must still boot if Supabase is unset):

```python
    app.state.supabase = None
    try:
        app.state.supabase = await create_service_client(settings)
    except Exception as exc:  # noqa: BLE001 - Ask is optional; don't block startup
        log.warning("supabase_client_unavailable", error=str(exc))
```

After `app = FastAPI(...)` and the `app.mount(...)` line, add CORS (only when origins are configured):

```python
_origins = [o.strip() for o in get_settings().ask_cors_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=_origins, allow_methods=["POST"],
        allow_headers=["authorization", "content-type"],
    )
```

Add the request model near the other Pydantic models and the route (place the route with the other `/api/*` routes):

```python
class AskRequest(BaseModel):
    query: str
    space_id: str | None = None


@app.post("/api/ask")
async def api_ask(req: AskRequest, request: Request):
    user_id = await user_id_from_bearer(
        request.headers.get("authorization"), app.state.supabase
    )
    if not user_id:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    result = await answer_question(
        app.state.supabase, app.state.llm,
        user_id=user_id, query=req.query, space_id=req.space_id,
    )
    return JSONResponse(result)
```

Add `Request` to the FastAPI import line: `from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pytest tests/web/test_ask_api.py -v`
Expected: PASS (both). If `tests/web/` has no `__init__.py` and the import fails, add an empty `tests/web/__init__.py` (match how `tests/agent/` is structured).

- [ ] **Step 6: Run the full backend suite (no regressions)**

Run: `pytest tests/agent/kb tests/web -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/kb_auth.py web/app.py tests/web/test_ask_api.py
git commit -m "feat(kb): POST /api/ask — Supabase-authed RAG endpoint + CORS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Portal Ask surface (`/app/ask` + client lib + nav)

**Files:**
- Create: `portal/src/lib/ask/client.ts`
- Create: `portal/src/lib/ask/client.test.ts`
- Create: `portal/src/components/ask/AskPanel.tsx`
- Create: `portal/src/app/app/ask/page.tsx`
- Modify: `portal/src/components/app-shell/Sidebar.tsx` (add "Ask" nav)

Run all portal commands from `/Users/aniquesabir/projects/stewardai/portal`.

**Interfaces:**
- Consumes: `POST /api/ask` (T7) at `process.env.NEXT_PUBLIC_ASK_API_URL`; the user's Supabase access token from `createBrowserClient().auth.getSession()`.
- Produces: the Ask view; no downstream consumers.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/ask/client.test.ts`:

```ts
import { splitAnswerWithCitations, askQuestion, type AskResult } from "./client";

describe("splitAnswerWithCitations", () => {
  it("splits [n] markers into text + citation tokens", () => {
    const parts = splitAnswerWithCitations("We ship Friday [1] and [2].");
    expect(parts).toEqual([
      { type: "text", value: "We ship Friday " },
      { type: "cite", n: 1 },
      { type: "text", value: " and " },
      { type: "cite", n: 2 },
      { type: "text", value: "." },
    ]);
  });

  it("returns a single text part when there are no citations", () => {
    expect(splitAnswerWithCitations("No sources here.")).toEqual([
      { type: "text", value: "No sources here." },
    ]);
  });
});

describe("askQuestion", () => {
  it("POSTs the query with a bearer token and returns the parsed result", async () => {
    const result: AskResult = { answer: "hi [1]", citations: [
      { n: 1, meeting_id: "m1", source_seq: 3, kind: "segment", snippet: "s" },
    ] };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => result,
    });
    // @ts-expect-error test stub
    global.fetch = fetchMock;

    const out = await askQuestion(
      { baseUrl: "https://api.example", token: "tok" },
      { query: "when?", spaceId: null },
    );
    expect(out).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example/api/ask");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ query: "when?", space_id: null });
  });

  it("throws on a non-ok response", async () => {
    // @ts-expect-error test stub
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(
      askQuestion({ baseUrl: "https://api.example", token: "t" }, { query: "q", spaceId: null }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/lib/ask/client.test.ts`
Expected: FAIL (`Cannot find module './client'`).

- [ ] **Step 3: Write the client lib**

Create `portal/src/lib/ask/client.ts`:

```ts
export type Citation = {
  n: number;
  meeting_id: string;
  source_seq: number | null;
  kind: string;
  snippet: string;
};

export type AskResult = { answer: string; citations: Citation[] };

export type AnswerPart =
  | { type: "text"; value: string }
  | { type: "cite"; n: number };

// Split an answer string into text runs and [n] citation tokens for rendering.
export function splitAnswerWithCitations(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: answer.slice(last, m.index) });
    parts.push({ type: "cite", n: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push({ type: "text", value: answer.slice(last) });
  return parts.length ? parts : [{ type: "text", value: answer }];
}

export async function askQuestion(
  auth: { baseUrl: string; token: string },
  req: { query: string; spaceId: string | null },
): Promise<AskResult> {
  const res = await fetch(`${auth.baseUrl}/api/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ query: req.query, space_id: req.spaceId }),
  });
  if (!res.ok) throw new Error(`Ask failed (${res.status})`);
  return (await res.json()) as AskResult;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/lib/ask/client.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Write the AskPanel client component**

Create `portal/src/components/ask/AskPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { askQuestion, splitAnswerWithCitations, type AskResult } from "@/lib/ask/client";

export function AskPanel({ spaceId = null }: { spaceId?: string | null }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  async function ask() {
    if (busy || !query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_ASK_API_URL;
      if (!token || !baseUrl) throw new Error("Ask is not available (sign in / configure API).");
      setResult(await askQuestion({ baseUrl, token }, { query: query.trim(), spaceId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const citById = new Map((result?.citations ?? []).map((c) => [c.n, c]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder="Ask about your meetings… e.g. where are we with Acme?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          disabled={busy}
        />
        <button
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          onClick={ask}
          disabled={busy || !query.trim()}
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed">
            {splitAnswerWithCitations(result.answer).map((part, i) =>
              part.type === "text" ? (
                <span key={i}>{part.value}</span>
              ) : (
                <sup key={i} className="mx-0.5 text-blue-600">
                  {citById.has(part.n) ? (
                    <Link href={`/app/meetings/${citById.get(part.n)!.meeting_id}`}>[{part.n}]</Link>
                  ) : (
                    <>[{part.n}]</>
                  )}
                </sup>
              ),
            )}
          </p>

          {result.citations.length > 0 && (
            <ol className="flex flex-col gap-1 border-t pt-3 text-xs text-gray-600">
              {result.citations.map((c) => (
                <li key={c.n}>
                  <Link href={`/app/meetings/${c.meeting_id}`} className="text-blue-600">
                    [{c.n}]
                  </Link>{" "}
                  <span className="text-gray-400">({c.kind})</span> {c.snippet}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write the Ask page**

Create `portal/src/app/app/ask/page.tsx`:

```tsx
import { AskPanel } from "@/components/ask/AskPanel";

export default function AskPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Ask Steward</h1>
        <p className="text-sm text-gray-500">
          Ask anything about your meetings and work. Answers cite the meetings they come from.
        </p>
      </div>
      <AskPanel />
    </div>
  );
}
```

- [ ] **Step 7: Add the "Ask" nav item**

In `portal/src/components/app-shell/Sidebar.tsx`, add `MessageCircle` (or another available lucide icon) to the icon import on line 6, then add a nav entry after the Meetings item (line ~18):

```tsx
  { href: "/app/ask", label: "Ask", icon: MessageCircle, isActive: (p) => p.startsWith("/app/ask") },
```

- [ ] **Step 8: Verify types, build, and tests**

Run:
```bash
npx tsc --noEmit && npm run build && npx jest
```
Expected: tsc clean; build "Compiled successfully" (the `/app/ask` route appears); Jest all green (existing suite + the new `client.test.ts`).

- [ ] **Step 9: Commit**

```bash
git add portal/src/lib/ask/client.ts portal/src/lib/ask/client.test.ts portal/src/components/ask/AskPanel.tsx portal/src/app/app/ask/page.tsx portal/src/components/app-shell/Sidebar.tsx
git commit -m "feat(spaces): Ask view — question box + cited answers + sidebar nav

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-Plan: deployment + config (not code tasks, do after the branch merges)

- Set env on the CX33 web backend: `EMBEDDING_MODEL` (defaults fine), `ASK_CORS_ORIGINS=https://<portal-domain>`; `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are already set for the scheduler.
- Set `NEXT_PUBLIC_ASK_API_URL=https://<cx33-domain>` in the portal (Vercel).
- **TLS dependency:** the CX33 box needs TLS/a domain so the Vercel portal (HTTPS) can `fetch` the Ask API without mixed-content/CORS failure. This is the same prerequisite noted for the voice `/pipeline` over `wss`.
- Apply migration `0010` to the production Supabase project when the KB ships (alongside `0009`).
- **Backfill:** `kb_chunks` only fills for meetings ingested after this lands. A one-off backfill (re-run `index_meeting_chunks` over existing meetings) is optional and can be a follow-up script; note it so Ask's empty early results aren't mistaken for a bug.

## Self-Review

**Spec coverage:**
- L1 "index/embed all meeting content" → T1 (store) + T2 (embed primitive) + T3 (chunk) + T4 (index at ingestion, transcript+summary+facts). ✅
- Retrieval stack "pgvector in Supabase" → T1; "text-embedding-004 768-dim via litellm.aembedding" → T2; "metadata-scoped then cosine top-k" → T1 RPC (`p_space_id` filter + cosine order) + T5. ✅
- "What gets embedded: transcript segments + summaries + facts with space_id/meeting_id/source_seq" → T3/T4 (all three kinds, provenance columns). ✅
- L2 "Ask: query a Space/entity/tag → synthesized, sourced answer" → T6 (`space_id` scope + `[n]` citations) + T7 (API) + T8 (UI). Entity/tag scoping beyond Space is deferred (v1 delivers global + per-Space; entity/tag filters are a thin follow-up on the same RPC). Noted, not silently dropped.
- "Synthesis via litellm complete() with citations to meeting_id/source_seq" → T6. ✅
- Open question "Ask surface: existing portal or new view" → resolved: new `/app/ask` page in the existing portal (+ `spaceId` prop ready for per-Space embedding later). ✅
- On-demand pre-meeting briefing (listed under L2 in the spec's v1 scope) is **not** in this plan — it's a distinct surface; flag for its own plan after Ask ships. Recorded here so it isn't mistaken as covered.

**Placeholder scan:** none — every code/SQL step has complete content.

**Type consistency:** chunk dict `{kind,text,source_seq}` is identical in T3 output, T4 consumption, and the Interfaces block; retrieved-row shape `{text,meeting_id,source_seq,kind,similarity}` matches the RPC `returns table(...)` (T1), `retrieve` return (T5), and `answer_question` consumption (T6); `AskResult`/`Citation` (T8) mirror `answer_question`'s return + T7's response body. `aembed(query=...)` used consistently (index `query=False`, retrieval `query=True`).
