# DB-Driven Integration Registry — Design

**Date:** 2026-07-04
**Status:** Approved (proceed to plan)

## Goal

Make the set of supported app integrations a single source of truth in the DB,
so the **chat backend** and the **portal** can never diverge again (the cause of
two bugs: the chat offered Notion which the portal couldn't connect; the chat
declined Google Drive which the portal had live). The LLM checks availability
against the registry; an available-but-unconnected app surfaces the Connect
dialog; an unavailable app is honestly "not supported yet."

## Requirements (from the user)

- Dynamic: when the LLM needs an integration it checks whether it's available.
- Availability lives in the DB (not hardcoded in two places).
- Available but not connected → show the Connect dialog.
- (Implied) The Google Workspace apps the user has connected (Drive/Docs/Sheets)
  should actually work in chat, not be declined.

## Architecture

### 1. Source of truth: `integrations` table (migration `0014`)

| column | type | notes |
|---|---|---|
| slug | text pk | e.g. `gmail`, `googledrive` |
| name | text | "Gmail" |
| category | text | "Email", "Docs", … |
| available | boolean | live/offered (connectable + usable) |
| sort_order | int | catalog display order |
| updated_at | timestamptz | |

`available` is the shared flag both sides read. Seeded (see §5). RLS enabled;
readable by any authenticated user (it's a non-sensitive catalog) via a permissive
`select` policy; writes are service-role only.

Note on **actions**: the per-app Composio action allow-list (which actions the
chat may call, + low/high risk) stays in backend code (`_ALLOW_LIST` in
`composio_service.py`) — it is safety-sensitive and the portal doesn't need it.
The DB owns *availability*; code owns *what each app can do*. An app is usable in
chat when it is `available` in the DB **and** has an `_ALLOW_LIST` entry; the
seed keeps these in step.

### 2. Backend reads the registry

New `src/stewardai/agent/chat/registry.py`:
- `async load_available(client) -> list[str]` — slugs where `available=true`,
  with a short in-process TTL cache (≈60s) so it isn't a DB hit per chat turn;
  falls back to `[]` on error (chat still works with its non-Composio tools).

`composio_service.py`:
- `get_tools(user_id, toolkits=None, *, only_connected=True)` and
  `list_connected(user_id, toolkits=None)` take an explicit `toolkits` list
  (defaults to all `_DEFINED_TOOLKITS`) instead of the module `TOOLKITS`
  constant. Drop the hardcoded `TOOLKITS` gate — the registry decides which apps
  are offered. `_ALLOW_LIST` (+ `_RISK_MAP`/`_ALLOWED_SLUGS`) remain the action
  definitions/safety net.

`composio_tools.build_composio_tools(user_id, composio_service, client, available)`:
- receives the `available` slugs (loaded from the registry by the caller,
  `web/app.py`), intersected with `_ALLOW_LIST` keys → the app set the chat
  offers. The three generic tools use it:
  - `list_integrations()` → available apps + connected status.
  - `describe_action(app)` → only if available; schemas for that app's
    `_ALLOW_LIST` slugs.
  - `run_integration_action(app, action, args_json)` → app available + action in
    that app's `_ALLOW_LIST` → gate → connect gate → execute (unchanged flow, so
    the approval card + Connect dialog behave as today).

### 3. Portal reads the registry

- `portal/src/lib/integrations/catalog.ts` becomes a fetch from the DB: a
  server helper `getIntegrationsCatalog()` reads `integrations` (ordered by
  `sort_order`) → the catalog + the connectable set. `SUPPORTED_TOOLKITS`
  (used by the connect/status/disconnect routes) derives from `available=true`
  rows. The connections page + `AppCard` render from the same data.
- Keep a small hardcoded fallback list so the portal still renders if the DB
  read fails.

### 4. Connect flow — unchanged

Available-but-not-connected still triggers the connect gate → the in-chat
Connect card (already wired to `POST /api/integrations/{app}/connect` + status
poll) and the settings page. No change.

### 5. Seed (migration `0014`)

| slug | available | why |
|---|---|---|
| gmail | true | live + actions |
| googlecalendar | true | live + actions |
| googledrive | true | user-connected; add read/safe-write actions |
| googledocs | true | add read/write actions |
| googlesheets | true | add read/write actions |
| notion | false | portal can't connect yet (coming soon) |
| slack | false | coming soon |

Backend `_ALLOW_LIST` gains `googledrive`/`googledocs`/`googlesheets` entries.
Their exact Composio action slugs are fetched from the prod box (which can reach
Composio) during implementation and pinned (read + safe-write only; no
destructive deletes). Result formatters added where the model reads raw JSON
unreliably (mirrors calendar/gmail formatters), otherwise trimmed.

## Approaches considered

- **A (chosen):** availability in DB (shared), actions in backend code. Lowest
  risk; fixes the divergence (availability was what drifted); portal needs only
  availability.
- **B:** put actions in the DB too (fully add-an-app-by-row). More "dynamic" but
  moves the safety allow-list into data + a bigger backend refactor; deferred.

## Error handling

- Registry load failure → `[]` available Composio apps (chat still runs with
  KB/product tools); portal falls back to its hardcoded list.
- Unknown/unavailable app in `describe_action`/`run_integration_action` → error
  result telling the model it isn't supported.
- New Google actions must be added to `_ALLOW_LIST` (so `execute`'s
  `_ALLOWED_SLUGS` safety check passes).

## Testing

- Migration applies; seed rows present.
- `registry.load_available` returns available slugs; caches; falls back to `[]`.
- `composio_service.get_tools/list_connected` honor an explicit `toolkits` arg.
- `build_composio_tools` offers only `available ∩ _ALLOW_LIST` apps;
  `list_integrations` reflects the registry; `describe_action` rejects
  unavailable apps.
- `_ALLOW_LIST`/`_RISK_MAP` cover the new Google slugs; risk classification
  correct.
- Portal: `getIntegrationsCatalog` maps rows → catalog; `SUPPORTED_TOOLKITS`
  derives from `available`; fallback on DB error. Catalog test updated.
- Live: a chat turn using Google Drive (search/read) works; an unavailable app
  (notion) is declined; an available-but-unconnected app shows the Connect card.

## Out of scope (v1)

- Actions in the DB (approach B).
- Per-user availability (registry is global).
- Destructive Composio actions (delete file, etc.).
