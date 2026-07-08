# Integration Registry Implementation Plan

> **For agentic workers:** execute task-by-task (TDD). Steps use `- [ ]`.

**Goal:** A DB `integrations` table is the single source of truth for which app
integrations are available; the chat backend and portal both read it; Google
Drive/Docs/Sheets become usable in chat.

**Architecture:** availability in DB (shared), action allow-list in backend code.
See `docs/superpowers/specs/2026-07-04-integration-registry-design.md`.

## Global Constraints

- Registry load failure or missing table → fall back to the current working set
  (`gmail`, `googlecalendar`) so behavior is unchanged before the migration is
  applied. Never break chat.
- New Composio actions must be added to `_ALLOW_LIST` (safety) with correct
  low/high risk; read + safe-write only (no destructive deletes).
- Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 0 (SPIKE): fetch Google Drive/Docs/Sheets action slugs

- [ ] On the prod box (reaches Composio), list each toolkit's actions; pick a
  small read + safe-write set per app (search/list/read; create/append/update;
  NO delete). Record exact slugs for `_ALLOW_LIST`.

### Task 1: migration `0014_integrations` + seed

**Files:** Create `portal/supabase/migrations/0014_integrations.sql`.

- [ ] `create table integrations (slug text pk, name text, category text,
  available boolean not null default false, sort_order int not null default 0,
  updated_at timestamptz not null default now())`; RLS on; permissive `select`
  policy for authenticated; seed the 7 apps (gmail/googlecalendar/googledrive/
  googledocs/googlesheets available=true; notion/slack false).
- [ ] Commit. (User applies it, like 0013; backend falls back until then.)

### Task 2: backend registry

**Files:** Create `src/stewardai/agent/chat/registry.py`; Test
`tests/agent/chat/test_registry.py`.

**Produces:** `async load_available(client) -> list[str]` (cached ~60s; fallback
`["gmail","googlecalendar"]` on error/missing table).

- [ ] Test: returns slugs where available; a fake client raising → fallback list;
  second call within TTL doesn't re-query (cache).
- [ ] Implement with a module-level `(ts, value)` cache + monotonic time passed in
  or `time.monotonic`. Commit.

### Task 3: composio_service — explicit toolkits + Google actions

**Files:** Modify `src/stewardai/integrations/composio_service.py`; Test
`tests/integrations/test_composio_service.py`.

- [ ] `get_tools(user_id, toolkits=None, *, only_connected=True)` and
  `list_connected(user_id, toolkits=None)` default `toolkits` to
  `_DEFINED_TOOLKITS`; remove the `TOOLKITS` constant gate (keep `_DEFINED_TOOLKITS`).
- [ ] Add `googledrive`/`googledocs`/`googlesheets` entries to `_ALLOW_LIST`
  (slugs from Task 0) → `_RISK_MAP`/`_ALLOWED_SLUGS` pick them up.
- [ ] Update tests (defined toolkits now 5; risk coverage includes new slugs).
  Commit.

### Task 4: chat tools read the registry

**Files:** Modify `src/stewardai/agent/chat/composio_tools.py`, `web/app.py`;
Test `tests/agent/chat/test_composio_tools.py`.

- [ ] `build_composio_tools(*, user_id, composio_service, client=None,
  available=None)`: offered = `available ∩ _ALLOW_LIST keys` (available defaults
  to `_DEFINED_TOOLKITS` when None). `_APP_ENUM`/list/describe/run use the offered
  set (not module `TOOLKITS`).
- [ ] `web/app.py`: before building tools, `available = await
  registry.load_available(app.state.supabase)`; pass to `build_composio_tools`.
- [ ] Tests: available=["gmail"] → only gmail offered; describe rejects a
  non-available app. Commit.

### Task 5: portal reads the registry

**Files:** Modify `portal/src/lib/integrations/catalog.ts`,
`portal/src/lib/composio.ts` (SUPPORTED_TOOLKITS), consumers; Test
`portal/src/lib/__tests__/catalog.test.ts`.

- [ ] Add `getIntegrationsCatalog()` (server) reading `integrations` via service
  client; `SUPPORTED_TOOLKITS` derives from available rows; hardcoded fallback on
  error. Update connections page + routes to use it. Update catalog test.
- [ ] `tsc` + `jest`. Commit.

### Task 6: result formatters for Google apps (light)

- [ ] Add compact formatters for the noisiest Google read results (e.g. Drive
  file list) mirroring calendar/gmail; otherwise rely on `_trim_result`. Commit.

### Task 7: verify + deploy

- [ ] Full suite (pytest, ruff, tsc, jest). Deploy backend. User applies `0014`.
  Live-verify: Drive search works in chat; notion declined; available-unconnected
  shows Connect card.

## Self-Review

- Availability in DB drives both sides (spec §1/§3). ✓
- Fallback keeps chat working pre-migration (Global Constraints, Task 2). ✓
- Google apps usable via new `_ALLOW_LIST` entries (Task 0/3). ✓
