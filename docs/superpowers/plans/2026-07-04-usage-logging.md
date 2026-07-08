# Usage Logging & Cost Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Log every LLM/embedding call (tokens, cost, model, latency, user, feature, tool calls, full prompt/response) to a `usage_logs` table via one global litellm callback, and surface it on an owner-only portal page.

**Architecture:** A `litellm` `CustomLogger` registered at startup captures every completion/embedding; a `ContextVar` set at each entry point (chat/ask/summary/voice) attributes the call to a user+feature+request; a pure `build_usage_row` maps the event to a row; a best-effort service-role insert writes it. A portal `/app/usage` page reads aggregates.

**Tech Stack:** Python (litellm, supabase async client, contextvars), Supabase/Postgres (migration SQL), Next.js App Router (portal page).

## Global Constraints

- Capture must NEVER raise into the caller (wrap the whole callback body).
- A log is never dropped: missing attribution → `feature="unknown"`, `user_id=None`.
- Full prompt + full response are stored (approved); retention purge default 90 days.
- Cost never silently 0 for a known model: litellm cost → override map → 0 + warning.
- Store money as `numeric(12,6)`; tokens as int defaulting 0.
- Never commit secrets; stage explicit paths; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 0 (SPIKE): Confirm contextvar reaches the litellm callback

**Files:** throwaway script only.

- [ ] Write a spike: set a `ContextVar` before `ChatLiteLLM(streaming=True).astream(...)`, register a litellm `CustomLogger` whose `async_log_success_event` reads the contextvar, and confirm the value is visible. If NOT visible, the fallback is passing `metadata=` on the call and reading `kwargs["litellm_params"]["metadata"]`.
- [ ] Decide attribution mechanism based on the result; the rest of the plan uses `usage_scope` either way (it sets the contextvar AND, if needed, is read at call sites to inject metadata).

### Task 1: `usage_scope` contextvar

**Files:** Create `src/stewardai/observability/__init__.py`, `src/stewardai/observability/usage_context.py`; Test `tests/observability/test_usage_context.py`.

**Produces:** `usage_scope(*, user_id, feature, request_id=None, thread_id=None, context=None)` (contextmanager) and `current_usage() -> dict` (returns `{}` when unset).

- [ ] Test: inside `with usage_scope(user_id="u", feature="chat")`, `current_usage()["user_id"]=="u"`; nested scope restores prior on exit; outside any scope `current_usage()=={}`.
- [ ] Implement with a `ContextVar[dict|None]` and token reset.
- [ ] Run tests; commit.

### Task 2: `build_usage_row` pure mapper

**Files:** Create `src/stewardai/observability/usage_logger.py`; Test `tests/observability/test_usage_logger.py`.

**Consumes:** `current_usage()`.
**Produces:** `build_usage_row(kwargs: dict, response_obj, start, end, *, ctx: dict) -> dict`; `_PRICE_OVERRIDES: dict[str, tuple[float,float]]`; `_cost(kwargs, response_obj) -> float`.

- [ ] Tests (use plain dicts / SimpleNamespace, NOT real litellm):
  - success: usage `{prompt_tokens:10, completion_tokens:5, total_tokens:15}`, `kwargs["response_cost"]=0.002` → row has input/output/total 10/5/15, cost_usd 0.002, status "success".
  - tool calls: `response_obj.choices[0].message.tool_calls=[{function:{name:"kb_search",arguments:'{"q":"x"}'}}]` → `tool_calls==[{"name":"kb_search","args":{"q":"x"}}]`.
  - failure via `status_override="error"`, error text → status "error", error set.
  - cost fallback: no `response_cost`, model in `_PRICE_OVERRIDES` → cost computed from tokens*rate.
  - attribution: `ctx={"user_id":"u","feature":"chat","request_id":"r"}` → row carries them; empty ctx → feature "unknown", user_id None.
- [ ] Implement `build_usage_row` + `_cost` (try `kwargs["response_cost"]`; else `litellm.completion_cost`; else override map; else 0 with warning) + `_PRICE_OVERRIDES` (seed `gemini/gemini-embedding-001`).
- [ ] Run tests; commit.

### Task 3: `UsageLogger` callback + best-effort insert

**Files:** Modify `src/stewardai/observability/usage_logger.py`; Test `tests/observability/test_usage_logger.py`.

**Produces:** `class UsageLogger(litellm CustomLogger)` with `async_log_success_event` / `async_log_failure_event`; `install_usage_logger(client_factory)` that registers it on `litellm.callbacks`; module writes rows via an injected async client, swallowing errors.

- [ ] Test: a fake client whose `.table().insert().execute()` raises → the logger's insert helper returns without raising (best-effort). A working fake client → `insert` called with a dict containing `model`, `cost_usd`.
- [ ] Test: `async_log_success_event` builds a row (via build_usage_row + current_usage) and calls the insert helper once.
- [ ] Implement; guard the whole body in try/except + `log.warning`.
- [ ] Run tests; commit.

### Task 4: Migration `0013_usage_logs.sql`

**Files:** Create `migrations/0013_usage_logs.sql`.

- [ ] Write CREATE TABLE `usage_logs` with all columns from the spec, 3 indexes, `alter table ... enable row level security` (no permissive select policy — service role only).
- [ ] Apply to Supabase (psql via SUPABASE db URL or the SQL editor path used for prior migrations) and confirm the table exists.
- [ ] Commit.

### Task 5: Register logger at startup + wire chat entry point

**Files:** Modify `web/app.py` (startup: `install_usage_logger`), `src/stewardai/agent/chat/session.py` (wrap `stream_turn`/`resume` body in `usage_scope`).

**Consumes:** `install_usage_logger`, `usage_scope`.

- [ ] In `web/app.py` startup, call `install_usage_logger` with a service-role async client factory (reuse `create_service_client`).
- [ ] In `ChatSession.stream_turn`/`resume`, wrap the drive loop in `usage_scope(user_id=self.user_id, feature="chat", request_id=<uuid4>, thread_id=self.thread_id)`. (uuid is fine here — not a workflow script.)
- [ ] Test: `tests/agent/chat/test_session.py` — assert a turn runs inside a usage scope (monkeypatch `current_usage` capture, or assert `usage_scope` entered). Keep it light; existing streaming tests must still pass.
- [ ] Run chat+web tests; commit.

### Task 6: Wire ask / summary / voice entry points

**Files:** Modify the Ask handler, summary generator, and voice session entry (exact paths located during execution) to wrap work in `usage_scope(feature=...)`.

- [ ] Add `usage_scope` at each; feature = "ask" | "summary" | "voice". user_id where available.
- [ ] Run relevant tests; commit.

### Task 7: Portal usage page `/app/usage` (owner-only)

**Files:** Create `portal/src/app/app/usage/page.tsx` and a small `portal/src/lib/usage.ts` (aggregate queries via service client); follow existing owner gating.

- [ ] Server component gated to owner; query totals (30d), per-user, per-model, per-feature, and recent expensive requests.
- [ ] `tsc` + build check; commit.

### Task 8: Retention purge

**Files:** Create `purge_usage_logs(older_than_days=90)` in `usage_logger.py` (or a small maintenance module); wire an optional scheduled call; add `USAGE_LOG_RETENTION_DAYS` to config.

- [ ] Test: purge builds the correct delete filter (mock client).
- [ ] Commit.

## Self-Review

- Spec coverage: capture (T2/T3/T5), attribution (T1/T5/T6), schema (T4), cost override (T2), portal page (T7), retention (T8), testing (each task). ✓
- Placeholder scan: Task 6/7 exact paths resolved at execution (located then, not left vague in code). ✓
- Type consistency: `build_usage_row(...)`, `usage_scope(...)`, `current_usage()`, `install_usage_logger(...)` used consistently. ✓
