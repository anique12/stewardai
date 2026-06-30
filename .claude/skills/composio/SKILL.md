---
name: composio-integration
description: Use when integrating, debugging, or extending Composio in StewardAI — connecting apps (Gmail/Calendar/Notion/Slack), per-user OAuth, fetching or executing tools, the agent's tool-calling, or any "ConnectedAccounts.initiate failed / 500 / Vercel Security Checkpoint / composio-core" error.
---

# Composio (StewardAI integration)

Composio gives the agent per-user, authenticated access to 1000+ apps (Gmail, Calendar, Notion, Slack…). It handles OAuth + token storage so our code never touches credentials.

## Source of truth (read these first, do NOT trust training data)
- **Installed SDK types** are authoritative for exact signatures: Python `composio` ≥ 0.17 (in `.venv`), TS `@composio/core` ≥ 0.13 (in `portal/node_modules`). The API changes fast — verify against the installed package, not memory.
- **Official docs:** `https://docs.composio.dev/llms-full.txt` — but it's WAF-blocked for headless fetch (see WAF note), so open it in a **browser** (the user can paste it back if a deep lookup is needed).

## ⛔ Use v3. NEVER the legacy SDK.
- Python: `from composio import Composio` (package **`composio`** ≥ 0.17).
- TypeScript: **`@composio/core`** (≥ 0.13).
- **NEVER `composio-core` (TS v0.5.x).** Its v2 API is incompatible with Composio's current v3 backend: `connectedAccounts.initiate` fails and its own error handler crashes (`getAPIErrorDetails` reading `.message` of undefined), masking the real error as an opaque 500. We hit this and migrated the portal off it (commit on feat/portal-v1).

## v3 terminology (old → current — translate, don't use old terms)
entity ID → **`user_id`** · actions → **tools** (`GMAIL_SEND_EMAIL`) · apps → **toolkits** (`gmail`) · integration → **auth config** (`ac_…`) · connection → **connected account** (`ca_…`) · toolset → **provider**.

## entity = Supabase `user.id` (always)
Pass the Supabase auth `user.id` (UUID) as the Composio `user_id`/`userId` everywhere. Portal and backend both do this, so a connection created by either SDK is visible to the other (same Composio account + same entity). Never use `default` (leaks other users' data) or an email (mutable).

## Connect flow (per-user OAuth) — portal, TS `@composio/core`
Managed OAuth, no manual dashboard setup needed:
1. Resolve a managed auth config: `authConfigs.list({ toolkit })`, else `authConfigs.create(slug, { type: "use_composio_managed_auth", name })`.
2. Initiate: **`connectedAccounts.link(userId, authConfigId, { callbackUrl })`** → `{ redirectUrl, id }`. Redirect the browser to `redirectUrl`.
   - **Use `link`, NOT `initiate`** — `initiate` is being retired for Composio-managed OAuth (cutover 2026-05-08 new orgs / 2026-07-03 all); `authorize` internally calls the retiring `initiate` and takes no `callbackUrl`.
3. Status reconcile: `connectedAccounts.list({ userIds, toolkitSlugs })` → map status → upsert `connected_apps`.
4. Disconnect: `connectedAccounts.delete(id)`.
- Wrap every Composio call in try/catch and return a real error (we return 502 + detail), never an opaque 500.

## Tools — backend agent (Python), the deliberate exception
The **blessed** v3 pattern is sessions: `composio.create(user_id, toolkits=[...], tools={tk:{enable:[...]}}, session_preset=SESSION_PRESET_DIRECT_TOOLS)` → `session.tools()` (provider-formatted) / `session.execute(slug, args)`. The low-level `composio.tools.get()/execute()` are documented as **"discouraged."**
**But we use the low-level API on purpose:** the live LiveKit voice agent needs **static function-tool registration up front**, whereas sessions hand the model meta-tools for *dynamic* discovery — wrong shape for LiveKit. So `src/stewardai/integrations/composio_service.py` uses:
- `tools.get(user_id, toolkits=[...])` → OpenAI-format tool schemas
- `tools.execute(slug, arguments, user_id, dangerously_skip_version_check=True)`
- a hard **allow-list** of action slugs + a `risk` map.
(If we ever want the idiomatic path, a session with the direct-tools preset is the refactor — not required.)

## StewardAI specifics
- **Apps v1:** `gmail`, `googlecalendar`, `notion`, `slack`. Allow-listed actions only.
- **Risk model:** high = outbound/irreversible (`GMAIL_SEND_EMAIL`, `SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL`) → confirm before run; everything else (reads, calendar create/update, Notion create/append, drafts) = low → auto.
- **LiveKit registration:** `function_tool(handler, raw_schema={"name","description","parameters"})` (livekit-agents 1.6.4) passes the Composio OpenAI-format schema straight to the LLM. (Do NOT `from livekit.agents.llm import CalledFunction` — it doesn't exist in 1.6.4 and silently disables all tools.)
- **Supabase tables:** `connected_apps` (user, app, status), `agent_actions` (proposed→approved→running→done/failed lifecycle; a poll worker in `scheduler/action_worker.py` executes approved rows).
- **Keys:** `COMPOSIO_API_KEY` in backend `.env` + `portal/.env.local` (server-side only). Same key works for both SDKs (it's a v3 key).
- **Web search** is available via the built-in `composio` toolkit (Composio Search) or Tavily/Exa/etc. — **premium-priced (~3×)** per Composio's pricing.

## ⚠️ The WAF gotcha (wasted hours once)
`backend.composio.dev` and `docs.composio.dev` sit behind a Cloudflare/Vercel bot-check that returns **403 "Vercel Security Checkpoint"** to headless/curl/WebFetch requests (and intermittently to the Python SDK from a laptop CLI). Calls from a **real server process** (the Next.js/node app, or a deployed backend) pass fine. So:
- Don't debug the connect/tool flow with CLI/curl probes — they'll spuriously 403. Test from the running portal (browser) or a server.
- To read the official docs, open them in a **browser** (passes the challenge) — that's how `reference.md` was captured.
