# Agentic Chat — Plan C1: Agent Core (read-only, streaming, over WebSocket)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A working agentic chat *brain* — reasons, searches the knowledge base and reads product data via tools, and streams a source-cited answer over a WebSocket — provider-agnostic (litellm), on LangGraph. No writes/permissions yet (that's C2), no portal UI yet (C3).

**Architecture:** LangGraph `create_react_agent` driven by `ChatLiteLLM` (Gemini default, any provider). Read-only tools wrap the existing KB `retrieve` + Supabase REST reads. A `/ws/chat` WebSocket on the existing `web.app` streams typed events (token / activity / citations / done). Threads persist best-effort via the REST service client (works even before migration `0011` is applied). Verified against the installed LangGraph API by a spike.

**Tech stack:** Python/asyncio, LangGraph (`create_react_agent`, `InMemorySaver`, `astream`), `langchain-litellm` (`ChatLiteLLM`), litellm (Gemini), Supabase REST, FastAPI WebSocket, pytest.

## Global Constraints

- **Provider-agnostic via litellm.** All model calls go through `ChatLiteLLM`. Defaults: reasoning `gemini/gemini-2.5-flash`, utility `gemini/gemini-2.5-flash-lite`. No provider hardcoded outside config.
- **Verified LangGraph API (from the spike — use exactly these):**
  - `from langchain_litellm import ChatLiteLLM` → `ChatLiteLLM(model="gemini/...", temperature=0, num_retries=4).bind_tools([...])`
  - `from langchain_core.tools import tool` (decorator) for tool defs.
  - `from langgraph.prebuilt import create_react_agent` → `create_react_agent(model, tools, prompt=SYSTEM, checkpointer=InMemorySaver())`
  - `from langgraph.checkpoint.memory import InMemorySaver`
  - Streaming: `async for mode, chunk in agent.astream(inp, config, stream_mode=["updates","messages"])`. `stream_mode="messages"` yields `(message_chunk, metadata)` where `message_chunk.content` is the token text; `"updates"` yields `{node_name: {...}}` dict updates.
  - Final state: `await agent.aget_state(config)` → `.values["messages"][-1]`.
- **Tenancy:** `user_id` comes only from the verified Supabase JWT (`web/kb_auth.py`); every tool is user-scoped; service-role REST re-filters by `user_id`.
- **Best-effort persistence:** the message store must NEVER raise into the chat turn — if `chat_*` tables don't exist yet (0011 unapplied), log and no-op (chat still works ephemerally).
- **Repo hygiene:** stage explicit paths only (never `git add -A`); commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; run Python via `./.venv/bin/python`; work in place.
- **No tool-internal leakage:** the system prompt instructs the model never to mention tool names/schemas/JSON in its answer.

---

## File Structure

- `pyproject.toml` — add `langgraph`, `langchain-litellm`, `langchain-core` deps.
- `src/stewardai/config.py` — add `chat_reasoning_model`, `chat_utility_model`.
- `src/stewardai/agent/chat/__init__.py` (new package)
- `src/stewardai/agent/chat/models.py` — `pick_model(role)`, `make_chat_llm(role)`.
- `src/stewardai/agent/chat/tools.py` — read tools (`kb_search`, `list_spaces`, `list_meetings`, `lookup_entity`) as a factory bound to `(client, llm, user_id)`.
- `src/stewardai/agent/chat/events.py` — map LangGraph stream chunks → typed events.
- `src/stewardai/agent/chat/graph.py` — build the agent + `run_chat_turn(...)` async event generator.
- `src/stewardai/agent/chat/store.py` — best-effort thread/message persistence (REST).
- `web/app.py` — add `/ws/chat`.
- `portal/supabase/migrations/0011_chat.sql` — `chat_threads`, `chat_messages`, RLS.
- `scripts/chat_smoke.py` — live end-to-end smoke.
- Tests: `tests/agent/chat/test_models.py`, `test_tools.py`, `test_events.py`, `test_store.py`, `tests/web/test_chat_ws.py`.

## Interfaces (contract across tasks)

```text
# T1
pick_model(role: "reasoning"|"utility") -> str            # litellm model id from config
make_chat_llm(role="reasoning", *, tools=None) -> ChatLiteLLM   # bound if tools given

# T2  (factory returns a list of langchain tools closed over client/llm/user_id)
build_read_tools(client, llm, *, user_id: str) -> list   # kb_search, list_spaces, list_meetings, lookup_entity
#   kb_search(query, space_id?) -> {"passages":[{"n","text","meeting_id","source_seq","kind"}]}

# T3
map_stream_event(mode: str, chunk) -> list[dict]          # -> [{type:"token"|"activity"|"citations"|..., ...}]

# T4
run_chat_turn(client, llm_reasoning, *, user_id, history: list[dict], message: str) -> AsyncIterator[dict]
#   yields typed events; terminal {"type":"done","answer":str,"citations":[...]}

# T5
create_thread(client,*,user_id,title)->str|None ; append_message(client,*,user_id,thread_id,role,parts)->None
list_threads(client,*,user_id)->list ; get_thread_messages(client,*,user_id,thread_id)->list
#   all best-effort: swallow "relation does not exist" -> log + return None/[]

# T6
WS /ws/chat : recv {type:"user_message", thread_id?, text} ; send the run_chat_turn events + {type:"thread",id}
```

---

### Task 1: Deps + config + model layer

**Files:** `pyproject.toml`, `src/stewardai/config.py`, `src/stewardai/agent/chat/__init__.py`, `src/stewardai/agent/chat/models.py`, `tests/agent/chat/__init__.py`, `tests/agent/chat/test_models.py`

- [ ] **Step 1 — failing test** `tests/agent/chat/test_models.py`:
```python
from stewardai.agent.chat.models import pick_model

def test_pick_model_uses_config_defaults():
    assert "gemini" in pick_model("reasoning")
    assert "flash-lite" in pick_model("utility")

def test_pick_model_unknown_role_falls_back_to_reasoning():
    assert pick_model("something") == pick_model("reasoning")
```
- [ ] **Step 2 — run, expect fail** `./.venv/bin/python -m pytest tests/agent/chat/test_models.py -v`
- [ ] **Step 3 — deps**: add to `pyproject.toml` dependencies: `langgraph>=0.2`, `langchain-litellm`, `langchain-core`. Run `./.venv/bin/pip install -q langgraph langchain-litellm langchain-core` (already installed in the venv during the spike; keep pyproject in sync).
- [ ] **Step 4 — config** in `src/stewardai/config.py` near `embedding_model`:
```python
    # Agentic chat (Plan C1+): per-role models, all via litellm (any provider swappable).
    chat_reasoning_model: str = "gemini/gemini-2.5-flash"
    chat_utility_model: str = "gemini/gemini-2.5-flash-lite"
```
- [ ] **Step 5 — implement** `src/stewardai/agent/chat/__init__.py` (empty) and `src/stewardai/agent/chat/models.py`:
```python
"""Provider-agnostic chat model layer. pick_model routes by role (config-driven);
make_chat_llm builds a ChatLiteLLM so any litellm-supported provider is swappable."""
from __future__ import annotations

from stewardai.config import get_settings


def pick_model(role: str = "reasoning") -> str:
    s = get_settings()
    if role == "utility":
        return s.chat_utility_model
    return s.chat_reasoning_model  # default / "reasoning"


def make_chat_llm(role: str = "reasoning", *, tools=None):  # noqa: ANN001
    import os
    from langchain_litellm import ChatLiteLLM

    s = get_settings()
    if s.gemini_api_key:
        os.environ.setdefault("GEMINI_API_KEY", s.gemini_api_key)
    llm = ChatLiteLLM(model=pick_model(role), temperature=0, num_retries=4)
    return llm.bind_tools(tools) if tools else llm
```
- [ ] **Step 6 — run, expect pass**; also `./.venv/bin/ruff check` the new files.
- [ ] **Step 7 — commit** `git add pyproject.toml src/stewardai/config.py src/stewardai/agent/chat/__init__.py src/stewardai/agent/chat/models.py tests/agent/chat/__init__.py tests/agent/chat/test_models.py`

---

### Task 2: Read tools (KB + product reads)

**Files:** `src/stewardai/agent/chat/tools.py`, `tests/agent/chat/test_tools.py`

**Interfaces:** Consumes existing `stewardai.agent.kb.retrieval.retrieve`. Produces `build_read_tools(client, llm, *, user_id) -> list` of langchain tools.

- [ ] **Step 1 — failing test** `tests/agent/chat/test_tools.py`: verify `build_read_tools` returns tools named `kb_search`, `list_spaces`, `list_meetings`, `lookup_entity`; and that invoking `kb_search` calls the injected retrieve and returns passages with provenance.
```python
from stewardai.agent.chat.tools import build_read_tools

class _Resp:
    def __init__(self, d): self.data = d
class _Q:
    def __init__(s, rows): s.rows = rows
    def select(s,*a,**k): return s
    def eq(s,*a,**k): return s
    def order(s,*a,**k): return s
    def limit(s,*a,**k): return s
    async def execute(s): return _Resp(s.rows)
class _Client:
    def __init__(s, rows): s.rows = rows
    def table(s, name): return _Q(s.rows)

class _LLM:
    async def aembed(self, texts, *, query=False): return [[0.0]*768 for _ in texts]

async def test_kb_search_returns_provenance(monkeypatch):
    import stewardai.agent.chat.tools as T
    async def fake_retrieve(client, llm, *, user_id, query, space_id=None, k=8):
        return [{"text":"ship July 17","meeting_id":"m1","source_seq":3,"kind":"fact","similarity":0.9}]
    monkeypatch.setattr(T, "retrieve", fake_retrieve)
    tools = build_read_tools(_Client([]), _LLM(), user_id="u1")
    names = {t.name for t in tools}
    assert {"kb_search","list_spaces","list_meetings","lookup_entity"} <= names
    kb = next(t for t in tools if t.name == "kb_search")
    out = await kb.ainvoke({"query":"when ship?"})
    assert out["passages"][0]["meeting_id"] == "m1" and out["passages"][0]["n"] == 1
```
- [ ] **Step 2 — run, expect fail**
- [ ] **Step 3 — implement** `src/stewardai/agent/chat/tools.py`. Use `langchain_core.tools.tool` via `StructuredTool.from_function` or closures. Each tool is an async function closed over `(client, llm, user_id)`; `kb_search` calls `retrieve(...)` and numbers passages (`n=i+1`). `list_spaces`/`list_meetings`/`lookup_entity` do user-scoped REST selects (`.eq("user_id", user_id)`). Return plain dicts (JSON-serializable). Reference pattern:
```python
from __future__ import annotations
from langchain_core.tools import StructuredTool
from stewardai.agent.kb.retrieval import retrieve

def build_read_tools(client, llm, *, user_id: str) -> list:  # noqa: ANN001
    async def kb_search(query: str, space_id: str | None = None) -> dict:
        rows = await retrieve(client, llm, user_id=user_id, query=query, space_id=space_id)
        return {"passages": [
            {"n": i+1, "text": r.get("text",""), "meeting_id": r.get("meeting_id"),
             "source_seq": r.get("source_seq"), "kind": r.get("kind")}
            for i, r in enumerate(rows)]}
    async def list_spaces() -> dict:
        resp = await client.table("spaces").select("id,name,kind,status").eq("user_id", user_id).execute()
        return {"spaces": resp.data or []}
    async def list_meetings(limit: int = 20) -> dict:
        resp = await (client.table("meetings").select("id,title,start_time,space_id,bot_status")
                      .eq("user_id", user_id).order("start_time", desc=True).limit(limit).execute())
        return {"meetings": resp.data or []}
    async def lookup_entity(name: str) -> dict:
        resp = await client.table("entities").select("id,kind,name,email,domain").eq("user_id", user_id).execute()
        q = name.strip().lower()
        hits = [e for e in (resp.data or []) if q in (e.get("name","") or "").lower()]
        return {"entities": hits}
    return [
        StructuredTool.from_function(coroutine=kb_search, name="kb_search",
            description="Search the user's meeting knowledge base. Returns passages with meeting_id + source_seq to cite."),
        StructuredTool.from_function(coroutine=list_spaces, name="list_spaces",
            description="List the user's Spaces (clients/projects/topics)."),
        StructuredTool.from_function(coroutine=list_meetings, name="list_meetings",
            description="List the user's recent meetings."),
        StructuredTool.from_function(coroutine=lookup_entity, name="lookup_entity",
            description="Find a person or company and basic details by name."),
    ]
```
- [ ] **Step 4 — run, expect pass**; ruff clean.
- [ ] **Step 5 — commit** explicit paths.

---

### Task 3: Stream-event mapping

**Files:** `src/stewardai/agent/chat/events.py`, `tests/agent/chat/test_events.py`

Pure function mapping a LangGraph `(mode, chunk)` to zero+ typed events for the client.

- [ ] **Step 1 — failing test**: feed a `("messages", (msg_chunk, meta))` where `msg_chunk.content="Hello"` → `[{"type":"token","delta":"Hello"}]`; feed an `("updates", {"tools": {"messages":[ToolMessage(name="kb_search", ...)]}})` → an `[{"type":"activity","kind":"tool","name":"kb_search","status":"done"}]`. Use light fakes/namedtuples for the chunk shapes.
- [ ] **Step 2 — run, expect fail**
- [ ] **Step 3 — implement** `map_stream_event(mode, chunk) -> list[dict]`: for `"messages"`, extract `.content` (skip empty / tool-call-only chunks) → token event; for `"updates"`, detect the `tools` node update and emit an `activity` (tool done) event with the tool name(s); detect the `agent` node update that contains tool_calls → emit `activity` tool "started". Keep it defensive (getattr, dict.get). Return `[]` for anything unrecognized.
- [ ] **Step 4 — run, expect pass**; ruff clean.
- [ ] **Step 5 — commit**.

---

### Task 4: The agent graph + run_chat_turn

**Files:** `src/stewardai/agent/chat/graph.py`, `tests/agent/chat/test_graph.py`

**Interfaces:** Consumes T1 (`make_chat_llm`), T2 (`build_read_tools`), T3 (`map_stream_event`). Produces `run_chat_turn(...)` async event generator + `build_chat_agent(...)`.

- [ ] **Step 1 — implement `build_chat_agent`** in `graph.py`:
```python
from __future__ import annotations
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import InMemorySaver
from stewardai.agent.chat.events import map_stream_event

SYSTEM = (
    "You are Steward, the user's personal assistant over their meetings, knowledge base, "
    "and work. Use your tools proactively to find real information before answering — do NOT "
    "ask the user for details you can look up yourself. When you use knowledge-base passages, "
    "cite each claim with [n] matching the passage numbers, and never invent facts not in the "
    "tools' results. Never mention tool names, schemas, JSON, or that a tool was called — just "
    "answer naturally. Be concise."
)

def build_chat_agent(llm, tools):  # noqa: ANN001
    return create_react_agent(llm, tools, prompt=SYSTEM, checkpointer=InMemorySaver())
```
- [ ] **Step 2 — implement `run_chat_turn`**: build tools (T2) + reasoning llm bound to those tools (T1), build the agent, `astream` with `stream_mode=["updates","messages"]`, run each `(mode,chunk)` through `map_stream_event`, yield events; accumulate the final assistant text + citations (collected from `kb_search` passages the agent used) and yield a terminal `{"type":"done","answer":...,"citations":[...]}`. Thread id → LangGraph `config={"configurable":{"thread_id":...}}` (use a per-turn uuid if none). `history` (prior messages) is prepended to the input messages.
- [ ] **Step 3 — test (light):** a `test_graph.py` that monkeypatches `build_chat_agent` to return a fake object whose `.astream` yields a scripted sequence and whose `.aget_state` returns a final message → assert `run_chat_turn` yields token events then a terminal `done` with the answer. (Keeps it offline; the real graph is proven by the T7 smoke.)
- [ ] **Step 4 — run, expect pass**; ruff clean. Commit.

---

### Task 5: Best-effort message store + migration 0011

**Files:** `src/stewardai/agent/chat/store.py`, `portal/supabase/migrations/0011_chat.sql`, `tests/agent/chat/test_store.py`

- [ ] **Step 1 — migration** `0011_chat.sql`:
```sql
-- 0011_chat.sql — agentic chat threads + messages (Plan C1).
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  space_id uuid references public.spaces(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  seq integer not null,
  parts jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, seq);
create index if not exists chat_threads_user_idx on public.chat_threads (user_id, updated_at desc);
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='chat_threads' and policyname='chat_threads_own') then
    create policy chat_threads_own on public.chat_threads for all using (user_id=auth.uid()) with check (user_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='chat_messages' and policyname='chat_messages_own') then
    create policy chat_messages_own on public.chat_messages for all using (user_id=auth.uid()) with check (user_id=auth.uid());
  end if;
end $$;
```
- [ ] **Step 2 — failing test** `test_store.py`: `create_thread` inserts a row + returns id; `append_message` inserts role/seq/parts; a client whose `.execute()` raises an exception with "relation" in the message → `create_thread` returns `None` and `append_message` no-ops (no raise). Use a fake client (chained query) like `tests/agent/kb/test_kb_persistence.py`.
- [ ] **Step 3 — implement** `store.py` with `create_thread`, `append_message`, `list_threads`, `get_thread_messages`; wrap every DB call in `try/except Exception` that logs `chat_store_unavailable` and returns a safe default (best-effort per Global Constraints).
- [ ] **Step 4 — run, expect pass**; ruff clean. Commit (include the migration).

---

### Task 6: `/ws/chat` WebSocket endpoint

**Files:** `web/app.py`, `tests/web/test_chat_ws.py`

- [ ] **Step 1 — failing test** `tests/web/test_chat_ws.py` using `fastapi.testclient.TestClient` websocket: monkeypatch `web.app.user_id_from_bearer` (returns "u1") and `web.app.run_chat_turn` (async-yields a token then done); connect to `/ws/chat?token=x`, send `{"type":"user_message","text":"hi"}`, assert it receives a `token` then a `done`. Second test: no/invalid token → server closes / sends error.
- [ ] **Step 2 — run, expect fail**
- [ ] **Step 3 — implement** `/ws/chat` in `web/app.py`: accept; read the `Authorization`/`token` (WS: token via query param `?token=` since headers are awkward — accept both `app.state.supabase` bearer via a first `{type:auth}` msg OR `?token=`); resolve `user_id` (401-close if none / supabase None → 1011). Loop: receive json; on `user_message`, best-effort `create_thread`/load history via store, then `async for ev in run_chat_turn(app.state.supabase, app.state.llm, user_id=..., history=..., message=text): await ws.send_json(ev)`; persist the user + assistant messages best-effort. Import `run_chat_turn` at module top so tests can monkeypatch `web.app.run_chat_turn`. Note: reuse `app.state.llm` (LiteLLMClient) for `aembed` inside kb_search's `retrieve`; the reasoning model is built inside `run_chat_turn` via `make_chat_llm`.
- [ ] **Step 4 — run, expect pass**; run `./.venv/bin/python -m pytest tests/agent/chat tests/web -q`; ruff clean. Commit.

---

### Task 7: Live smoke script

**Files:** `scripts/chat_smoke.py`

- [ ] **Step 1 — implement** `scripts/chat_smoke.py` (mirrors `seed_kb_test_meeting.py` conventions): resolve `user_id` (first meetings row or `--user-id`), build the service client + `make_llm`, then `async for ev in run_chat_turn(client, llm, user_id=user_id, history=[], message=args.q)` printing tokens inline and activity/citation events; default question "Where are we with Acme and what's still open?". `# ruff: noqa: E501` if needed.
- [ ] **Step 2 — run it live:** `./.venv/bin/python scripts/chat_smoke.py` → expect a streamed, cited answer that used `kb_search` against the seeded Acme data. This is the C1 acceptance test.
- [ ] **Step 3 — commit**.

---

## Self-Review

- **Spec coverage (C1 slice):** LangGraph+litellm agent ✅ (T1,T4); read tools incl. kb_search with provenance ✅ (T2); streaming protocol subset ✅ (T3,T6); persistence best-effort + 0011 ✅ (T5); WS endpoint + JWT auth ✅ (T6); live proof ✅ (T7). Permissions/actions (C2) and portal UI (C3) are intentionally out of C1.
- **Placeholders:** none — real code/SQL in each task.
- **Type consistency:** passage shape `{n,text,meeting_id,source_seq,kind}` identical in T2 output, T4 citation collection, and the Interfaces block; event `{type,...}` shape consistent across T3/T4/T6.
- **Deferred to C2:** calendar tool (Composio), entity/tag write, permission tiers/interrupts, allowlist, connect-required.
- **Note:** migration `0011` apply to Supabase is a user/ops action (like `0010`); C1 code runs best-effort without it (ephemeral chat), so the smoke (T7) does not require `0011`.
