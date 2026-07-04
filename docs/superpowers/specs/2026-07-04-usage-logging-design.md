# Usage Logging & Cost Attribution — Design

**Date:** 2026-07-04
**Status:** Approved (proceed to plan)

## Goal

Log every LLM/embedding call across StewardAI — tokens, cost, model, latency,
user, feature, tool calls, full prompt/response — so the owner can (a) decide a
pricing model from real per-user spend and (b) debug/observe agent behavior.

## Requirements (from the user)

- For each request: input tokens, output tokens, cost, model, "where it
  belongs" (feature/context), user, prompt, response, tool calls — "everything
  which helps deciding a pricing model" and gives observability.
- Scope: **all model usage** (chat, KB Ask/RAG, meeting summaries, embeddings,
  voice pipeline).
- Content: **full prompt + full response** stored.
- A **portal usage page** (owner-only) in addition to the raw data.

## Architecture

Two moving parts: a single global **capture** hook and a per-entry-point
**attribution** context. Storage is one Supabase table; a portal page reads
aggregates.

### 1. Capture — one global litellm callback

All models route through litellm (chat via LangChain `ChatLiteLLM`, plus
embeddings / Ask / summaries / voice). litellm exposes a global callback that
fires once per completion/embedding with the response. We register a
`CustomLogger` subclass (`litellm.callbacks = [UsageLogger()]`) at process
startup (web app + any worker entrypoint).

The logger implements `async_log_success_event(kwargs, response_obj, start_time,
end_time)` and `async_log_failure_event(...)`. From each event it derives a row
via a **pure function** `build_usage_row(kwargs, response_obj, start, end, ctx)`
so the mapping is unit-testable without litellm:

- `model` ← `kwargs["model"]`; `provider` derived from the `provider/model` prefix.
- `input_tokens` / `output_tokens` / `total_tokens` ← `response_obj.usage`
  (`prompt_tokens` / `completion_tokens` / `total_tokens`); embeddings report
  `prompt_tokens` only (output = 0).
- `cost_usd` ← `kwargs["response_cost"]` when litellm set it; else
  `litellm.completion_cost(response_obj)`; else a local override map
  (`_PRICE_OVERRIDES[model] = (in_rate, out_rate)` per 1M tokens) so a model
  litellm can't price (e.g. `gemini-embedding-001`) never logs a silent 0.
- `latency_ms` ← `(end_time - start_time)` in ms.
- `tool_calls` ← `response_obj.choices[0].message.tool_calls` → `[{name, args}]`
  (empty for embeddings / plain answers).
- `prompt` ← `kwargs["messages"]` (JSON); `response` ← the message content.
- `status` = "success" | "error"; `error` = message on failure.

The logger **never raises** into the caller — the whole body is wrapped so a
logging fault cannot break a turn.

### 2. Attribution — a contextvar set at each entry point

Because the LLM call happens deep inside LangGraph (and inside Ask/summary/voice
code), the callback learns *who/what* from a `ContextVar[dict | None]`
(`usage_context`) holding `{user_id, feature, request_id, thread_id, context}`.
A small helper sets/resets it:

```python
with usage_scope(user_id=..., feature="chat", request_id=..., thread_id=..., context={...}):
    ... run the turn ...
```

`build_usage_row` reads the contextvar; when unset it still writes the row with
`feature="unknown"`, `user_id=None` — **a log is never dropped**, attribution is
best-effort. `request_id` (one per user request/turn) groups the several LLM
calls a single turn makes, so spend rolls up to turn → user → day.

Entry points that set the scope:
- **chat** — `ChatSession.stream_turn` / `resume` (feature="chat",
  request_id per turn, thread_id, context = cited space/meetings if known).
- **ask** — the `/api/ask` handler path (feature="ask").
- **summary** — meeting summary generation (feature="summary").
- **voice** — the voice pipeline session (feature="voice").

**Risk to verify first (plan Task 1):** contextvar propagation through
`ChatLiteLLM`'s async streaming into the litellm callback. If it does not hold,
fall back to passing `metadata={...}` on the call and reading it from
`kwargs["litellm_params"]["metadata"]`. A spike confirms which path works before
the rest is built.

### 3. Storage — `usage_logs` table (migration `0013`)

One row per model call:

| column | type | notes |
|---|---|---|
| id | uuid pk | `gen_random_uuid()` |
| created_at | timestamptz | `now()` |
| user_id | uuid null | attribution; null for system/unknown |
| feature | text | chat / ask / summary / voice / embedding / unknown |
| request_id | uuid null | groups calls in one user request |
| thread_id | uuid null | chat only |
| model | text | e.g. `gemini/gemini-2.5-pro` |
| model_role | text null | reasoning / utility / embedding |
| provider | text null | gemini, etc. |
| input_tokens | int | default 0 |
| output_tokens | int | default 0 |
| total_tokens | int | default 0 |
| cost_usd | numeric(12,6) | default 0 |
| latency_ms | int null | |
| status | text | success / error |
| error | text null | |
| tool_calls | jsonb null | `[{name, args}]` |
| prompt | jsonb null | full input messages |
| response | text null | full model output |
| context | jsonb null | space_id, meeting_ids, … |

Indexes: `(user_id, created_at)`, `(feature, created_at)`, `(request_id)`.
RLS enabled; writes use the service-role client (bypasses RLS). No end-user
read policy (owner-only page uses the service client).

### 4. Write path

A module-level lazy service-role async Supabase client. The callback inserts one
row per call, best-effort (`try/except` swallow + `log.warning`). Volume is low
(interactive turns), so no queue/batching in v1.

### 5. Portal usage page — `/app/usage` (owner-only)

Server component using the service client, gated to the owner (email match /
role check consistent with existing admin gating). Shows:
- Total spend + tokens (last 30 days), and per-day trend.
- Spend per user (sortable), per model, per feature.
- "Most expensive recent requests" table; a row drills into full
  prompt/response/tool-calls.

### 6. Retention

Full prompt/response is sensitive (meeting/KB content). Ship a documented,
configurable purge: delete `usage_logs` older than `USAGE_LOG_RETENTION_DAYS`
(default 90). v1 provides a `purge_usage_logs(older_than_days)` function +
a scheduled call in the existing scheduler (or a documented cron); the table
and capture do not depend on it.

## Components (isolation)

- `stewardai/observability/usage_context.py` — the `ContextVar` + `usage_scope`
  contextmanager. No deps.
- `stewardai/observability/usage_logger.py` — `build_usage_row` (pure) +
  `UsageLogger` (litellm CustomLogger) + best-effort insert + `_PRICE_OVERRIDES`.
- `migrations/0013_usage_logs.sql` — the table + indexes + RLS.
- Entry-point wiring — 4 small edits (chat session, ask, summary, voice) wrapping
  the work in `usage_scope(...)`.
- `portal/src/app/app/usage/page.tsx` (+ a small aggregate query lib) — the page.

## Approaches considered

- **A (chosen):** global litellm callback + contextvar attribution + one
  `request_id`-grouped table + portal page. Catches every call with minimal
  touch; attribution best-effort but usually present.
- **B:** manual logging at each call site. More control over content, but
  duplicated code and easy to miss a call → under-counts spend.
- **C:** callback for cost/tokens + a separate per-turn chat log. Two tables;
  the single `request_id`-grouped table already yields both per-call and
  per-turn views, so C is unnecessary complexity.

## Error handling

- Capture never raises into the turn (full try/except).
- Missing cost → override map → still non-zero where a rate is known; else 0 with
  a `warning` log naming the unpriced model.
- Missing attribution → `feature="unknown"`, `user_id=None`; row still written.

## Testing

- `build_usage_row` pure-mapping tests: success (tokens/cost/tool-calls/response),
  failure event (status/error), embedding shape (output=0), cost fallback +
  override, attribution from contextvar vs unset.
- `usage_scope` set/reset (nested scopes restore prior value).
- Best-effort insert swallows a client error (no raise) — with a fake client.
- Portal aggregate query returns expected shapes from mock rows.
- Migration applies cleanly (0013).
- Live verification: one real chat turn writes ≥1 `usage_logs` row with
  non-zero tokens and a cost, attributed to the user + feature="chat".

## Out of scope (v1)

- Charts beyond a simple per-day trend.
- Budgets/alerts/rate-limiting.
- Backfilling historical usage (none was captured before this).
