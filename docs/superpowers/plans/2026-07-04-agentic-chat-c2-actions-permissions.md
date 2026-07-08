# Agentic Chat — Plan C2: Acting + Permissions

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Give the C1 agent *hands* — product-ops tools (operate StewardAI: spaces, tags, filing, action items) and external Composio tools — behind a Claude-Code permission model (auto for reads/reversible, approve-with-preview for outward/irreversible), with a per-user allowlist and just-in-time "Connect [App]" auth. Built on the verified LangGraph `interrupt()`/`Command(resume=)` flow.

**Architecture:** Each side-effecting tool executor consults the permission tier + allowlist; when a gate is required it calls `interrupt({...})`, which suspends the graph. A per-thread persistent agent+checkpointer lets the `/ws/chat` loop surface a `permission_request`/`connect_required` event, await the client's decision, and resume with `Command(resume=...)`. Product-ops wrap the existing portal mutation logic; external tools reuse the voice agent's Composio wiring.

**Tech stack:** LangGraph (`interrupt`, `Command`, persistent `InMemorySaver` per thread), litellm/Gemini, Supabase REST, existing Composio integration, FastAPI WS, pytest.

## Global Constraints

- **Verified interrupt/resume pattern (from the C2 spike — use exactly):**
  - In a tool executor: `decision = interrupt({...payload...})`; on first pass this SUSPENDS the graph; on resume it RETURNS the value passed to `Command(resume=value)`.
  - In `astream(..., stream_mode=["updates","messages"])`, an interrupt surfaces as an `("updates", chunk)` where `chunk` is a dict containing `"__interrupt__"` → a list whose `[0].value` is the payload. `await agent.aget_state(cfg)` then has `state.next == ("tools",)`.
  - Resume: `agent.astream(Command(resume=<decision>), cfg, stream_mode=[...])` on the SAME `thread_id`/checkpointer continues the graph.
  - **The agent + checkpointer MUST be the same instance across the interrupt** — build once per thread, reuse for resume (do NOT rebuild per turn as C1 did).
- **Permission tiers:** `read` (auto), `reversible` (auto-execute, emit a receipt), `outward` (interrupt → approve/reject). A per-user **allowlist** (`tool_permissions`) can upgrade `outward` → auto for a given tool.
- **Tenancy:** `user_id` from the verified JWT only; every tool + write user-scoped; Composio entity = `user.id`. Product-op tools re-check ownership of any target row (space/meeting) before mutating (service-role bypasses RLS).
- **Best-effort still holds** for the store; permission/allowlist reads are best-effort (missing `tool_permissions` table → treat as "not allowlisted" = gate as normal).
- **No tool-internal leakage** into answers (system prompt already forbids it in C1).
- **Repo hygiene:** explicit `git add`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; `./.venv/bin/python`.

## File Structure

- `src/stewardai/agent/chat/permissions.py` — tier registry, allowlist check, `gate(tool_name, tier, payload)` helper that interrupts when needed.
- `src/stewardai/agent/chat/write_tools.py` — product-ops tools (create_space, rename_space, archive_space, file_meeting, add_tag, remove_tag, complete_action_item, reopen_action_item) as a factory `build_write_tools(client, *, user_id)`.
- `src/stewardai/agent/chat/composio_tools.py` — `build_composio_tools(*, user_id)` reusing the voice agent's Composio wiring; each wrapped with the permission gate + `connect_required` detection.
- `src/stewardai/agent/chat/session.py` — `ChatSession` holding a per-thread persistent agent+checkpointer; `stream_turn(message)` and `resume(decision)` async generators that yield typed events (incl. `permission_request`, `connect_required`).
- `src/stewardai/agent/chat/graph.py` — refactor: `build_chat_agent` takes ALL tools (read+write+composio); `run_chat_turn` becomes a thin wrapper over `ChatSession` (keep back-compat for the C1 smoke).
- `web/app.py` — `/ws/chat` orchestrates interrupt/resume via `ChatSession`, handles `permission_decision` + `connect_done` client messages.
- `src/stewardai/agent/chat/store.py` — add `is_allowed`, `set_allowed`, `get_allowlist` (tool_permissions).
- `portal/supabase/migrations/0012_tool_permissions.sql`.
- `scripts/chat_act_smoke.py` — live smoke of an approval-gated action.
- Tests alongside each module.

## Interfaces

```text
# permissions.py
TIER = {"kb_search":"read", ..., "create_space":"reversible", "send_email":"outward", ...}
def tier_of(tool_name)->str
async def gate(client,*,user_id,tool_name,payload)->str
    # returns "auto" (proceed silently), or the interrupt() decision ("approve"/"reject") for gated tools;
    # checks allowlist first (allowlisted outward -> "auto")

# write_tools.py
build_write_tools(client,*,user_id)->list   # langchain StructuredTools; each executor: ownership re-check ->
    # gate(...) -> if approved/auto do the REST mutation and return a receipt dict; else return {"skipped":True}

# composio_tools.py
build_composio_tools(*,user_id)->list        # reuse existing Composio; on unconnected app the executor
    # returns/raises a CONNECT_REQUIRED sentinel -> surfaced as connect_required event

# session.py
class ChatSession:
    def __init__(self, client, llm, *, user_id, thread_id)
    async def stream_turn(self, message, history)->AsyncIterator[dict]   # yields events; if it hits a gate,
        # yields {"type":"permission_request"|"connect_required", "call_id",...} and returns (suspended)
    async def resume(self, decision)->AsyncIterator[dict]                # continue after a decision

# store.py additions
async def is_allowed(client,*,user_id,tool_name)->bool
async def set_allowed(client,*,user_id,tool_name)->None
```

---

### Task 1: Migration 0012 + permission tiers/allowlist

**Files:** `portal/supabase/migrations/0012_tool_permissions.sql`, `src/stewardai/agent/chat/permissions.py`, `src/stewardai/agent/chat/store.py` (add allowlist fns), `tests/agent/chat/test_permissions.py`, extend `tests/agent/chat/test_store.py`.

- [ ] **Migration** `0012_tool_permissions.sql`:
```sql
-- 0012_tool_permissions.sql — per-user tool allowlist (Claude-Code-style "always allow").
create table if not exists public.tool_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  scope text,                       -- optional (e.g. app or space); null = whole tool
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, tool_name, scope)
);
create index if not exists tool_permissions_user_idx on public.tool_permissions (user_id, tool_name);
alter table public.tool_permissions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='tool_permissions' and policyname='tool_permissions_own') then
    create policy tool_permissions_own on public.tool_permissions for all using (user_id=auth.uid()) with check (user_id=auth.uid());
  end if;
end $$;
```
- [ ] **permissions.py:** a `TIER` dict mapping tool names → `"read"|"reversible"|"outward"` (kb_search/list_*/lookup_entity=read; create_space/rename_space/file_meeting/add_tag/remove_tag/complete_action_item/reopen_action_item=reversible; archive_space/send_email/create_calendar_event/create_notion_page/post_slack_message=outward). `tier_of(name)` defaults unknown → `"outward"` (safe: unknown tools gate). `async def gate(client, *, user_id, tool_name, payload) -> str`: `read`/`reversible` → return `"auto"`; `outward` → if `await is_allowed(client, user_id=user_id, tool_name=tool_name)` return `"auto"`, else `decision = interrupt({"kind":"permission","tool":tool_name, **payload})`; if `decision == "always"`: `await set_allowed(...)` then return `"approve"`; return `decision`.
- [ ] **store.py:** `is_allowed` (select from tool_permissions where user_id+tool_name+allowed; best-effort False on error), `set_allowed` (upsert allowed=true; best-effort), `get_allowlist`.
- [ ] **Tests:** `tier_of` classification incl. unknown→outward; `gate` returns "auto" for read/reversible without interrupting (monkeypatch `interrupt` to raise if called); for outward when allowlisted returns "auto"; for outward not-allowlisted calls `interrupt` (monkeypatch to return "approve") → "approve"; "always" path calls set_allowed. store allowlist fns with fake client incl. missing-table → False/no-raise.
- [ ] Run `tests/agent/chat -q`, ruff, commit.

---

### Task 2: Product-ops write tools

**Files:** `src/stewardai/agent/chat/write_tools.py`, `tests/agent/chat/test_write_tools.py`

- [ ] `build_write_tools(client, *, user_id) -> list` of StructuredTools. For each write tool the async executor: (1) **ownership re-check** where it targets an existing row (e.g. `file_meeting(meeting_id, space_id)` verifies both the meeting and space belong to `user_id` via `.eq("id",..).eq("user_id",user_id)`; abort with `{"error":"not found"}` if not); (2) `d = await gate(client, user_id=user_id, tool_name=<name>, payload={...preview...})`; (3) if `d in ("auto","approve")` perform the REST mutation (reuse the exact column writes the portal routes / `agent.kb.persistence` use) and return a receipt `{"ok":True,"summary":"...","undo":{...}}`; else return `{"skipped":True}`. Tools: `create_space(name, kind?)`, `rename_space(space_id, name)`, `archive_space(space_id)` (outward tier), `file_meeting(meeting_id, space_id)`, `add_tag(meeting_id, tag)`, `remove_tag(meeting_id, tag)`, `complete_action_item(action_item_id)`, `reopen_action_item(action_item_id)`. (Check the `action_items` table schema in `0001` for the status column; mark done via its status field.)
- [ ] **Tests** (fake client + monkeypatch `gate` to return "auto"): each tool performs the expected insert/update with `user_id`; ownership re-check rejects a foreign/absent row; a `gate`→"reject" path returns `{"skipped":True}` and does NO mutation. (Monkeypatch `stewardai.agent.chat.write_tools.gate`.)
- [ ] Run, ruff, commit.

---

### Task 3: ChatSession (persistent agent + interrupt-aware streaming)

**Files:** `src/stewardai/agent/chat/session.py`, refactor `src/stewardai/agent/chat/graph.py`, `tests/agent/chat/test_session.py`

- [ ] **session.py `ChatSession`:** builds the agent ONCE (`build_chat_agent(make_chat_llm("reasoning", tools=all_tools), all_tools)`) with an `InMemorySaver`, stored on the instance; `thread_id` fixed per session. `stream_turn(message, history)`: astream the input; for each `(mode,chunk)` run `map_stream_event`; **detect interrupt**: if `mode=="updates"` and `"__interrupt__" in chunk`, yield `{"type": chunk["__interrupt__"][0].value.get("kind")=="connect" and "connect_required" or "permission_request", "call_id":<thread_id>, **payload}` and RETURN (suspend). If the stream completes without interrupt, collect citations + yield `done`. `resume(decision)`: `astream(Command(resume=decision), cfg, ...)`, same event handling (may hit another interrupt or finish).
- [ ] **graph.py refactor:** `build_chat_agent(llm, tools)` unchanged signature; `run_chat_turn(client, llm, *, user_id, history, message)` becomes: build a `ChatSession` (read tools only, for back-compat with the C1 smoke) and delegate to `stream_turn` — so `scripts/chat_smoke.py` still works. All-tools wiring happens in the WS (T4).
- [ ] **Tests (offline):** monkeypatch the agent inside a `ChatSession` with a fake whose `.astream` yields (a) a token then a `__interrupt__` update → assert `stream_turn` yields a `token` then a `permission_request` and stops (no `done`); (b) `.astream(Command(...))` yields a token + finishes → `resume` yields `token` + `done`. Keep offline.
- [ ] Run full `tests/agent/chat -q` (C1 tests must still pass after the graph refactor), ruff, commit.

---

### Task 4: `/ws/chat` interrupt/resume orchestration + all tools

**Files:** `web/app.py`, `tests/web/test_chat_ws.py` (extend)

- [ ] Refactor `ws_chat`: keep a `ChatSession` per `thread_id` for the connection (dict on the handler). On `user_message`: build the session with **all tools** (`build_read_tools + build_write_tools + build_composio_tools`, all closed over `user_id`), `async for ev in session.stream_turn(text, history): await ws.send_json(ev)`; if an event is `permission_request` or `connect_required`, STOP consuming and remember the session is suspended (do not append assistant msg yet). On a subsequent client `{"type":"permission_decision","decision":"approve|reject|always"}` → `async for ev in session.resume(decision): send`; on `{"type":"connect_done"}` → `session.resume("retry")`. When a turn reaches `done`, persist the assistant message. Guard everything (malformed frame, exceptions → generic error) as in C1.
- [ ] **Tests:** extend with a permission round-trip: monkeypatch a `ChatSession` (or the session factory) so `stream_turn` yields a `permission_request`, then client sends `permission_decision`, then `resume` yields `done`. Assert the client receives `permission_request` then `done`.
- [ ] Run `tests/web tests/agent/chat -q`, ruff, commit.

---

### Task 5: Composio tools + connect-required

**Files:** `src/stewardai/agent/chat/composio_tools.py`, `tests/agent/chat/test_composio_tools.py`

- [ ] **Investigate first:** read how the voice agent builds Composio tools (`src/stewardai/agent/live_tools.py` + how `meeting_runner` passes `user_id`/entity). Reuse that to list + wrap the user's Composio tools for the chat. Each wrapped executor: detect "app not connected" (Composio raises/returns a not-connected error) → return a `CONNECT_REQUIRED` sentinel dict `{"connect_required":True,"app":<app>}` (the tool then calls `interrupt({"kind":"connect","app":app,...})` so the WS surfaces a `connect_required`; on resume "retry" it re-attempts). Apply the permission `gate` (all Composio actions are `outward` tier → approve-with-preview) BEFORE executing.
- [ ] **Scope note (log it):** if wiring the full Composio *tool-router* (semantic discovery over all tools) proves large, ship v1 with the concrete tools the voice agent already exposes (Gmail/Calendar/Notion/Slack) and record the tool-router as a follow-up — the permission + connect patterns are identical regardless.
- [ ] **Tests:** with a faked Composio client: a connected app → tool executes (after gate "auto"); an unconnected app → returns/interrupts `connect_required` with the app name. Keep offline (fake Composio).
- [ ] Run, ruff, commit.

---

### Task 6: Live smoke — approval-gated action

**Files:** `scripts/chat_act_smoke.py`

- [ ] Mirror `chat_smoke.py` but drive an action turn against the live DB, providing decisions programmatically: build a `ChatSession` with read+write tools; `stream_turn("Create a space called 'Spike Test' and tell me when it's done")`; when a `permission_request`/`done` arrives print it; if a `permission_request` appears (archive/outward), feed `resume("approve")`. `create_space` is `reversible` (auto) so it should execute without a gate and return a receipt — assert a space row was created (then clean it up: delete the created space by id via REST). Print the streamed events + the receipt.
- [ ] **Run it live:** `./.venv/bin/python scripts/chat_act_smoke.py` → expect the agent to call `create_space`, the space to exist, and a confirming answer. This is C2's acceptance test.
- [ ] Commit.

## Self-Review

- Spec coverage (C2 slice): product-ops ✅ (T2), permission tiers + allowlist ✅ (T1), interrupt/resume over WS ✅ (T3,T4), Composio + connect-required ✅ (T5), live proof ✅ (T6). Full tool-router = documented follow-up (T5).
- Placeholders: none.
- Type consistency: `gate` return contract ("auto"/"approve"/"reject") consistent across permissions/write_tools/composio; event `permission_request`/`connect_required` shape consistent T3↔T4.
- Migrations `0011`+`0012` apply = user/ops action (best-effort code runs without them; allowlist absent → everything gates normally, which is safe).
