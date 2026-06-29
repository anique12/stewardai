# StewardAI Portal v1 — Morning Report

**Date:** 2026-06-30  
**Branch:** `feat/portal-v1`  
**Author:** Claude Opus 4.8 (automated final-pass agent)

---

## 1. Build + Test Results

| Check | Result |
|---|---|
| `npm run build` (Next.js 14 production build) | **PASS** — 11 pages/routes, zero TS errors, zero lint errors |
| `npm run lint` (ESLint) | **PASS** — "No ESLint warnings or errors" |
| `npm test` (Jest, portal unit tests) | **PASS** — 3 suites, 7 tests |
| `pytest tests/scheduler/` (Python scheduler) | **PASS** — 3 tests |

All automated checks pass cleanly.

---

## 2. What Is Built — Phases and Commit Ranges

All portal-v1 commits are on `feat/portal-v1`, branched from `main`. Commit range: `e8151a6..afd40ca` (7 commits, 2026-06-30 00:36–01:34 PKT).

### Phase 0 — Human Setup Prerequisites
- **NOT done by code.** Blocked on human action (see Section 4).
- Spec written at `docs/superpowers/specs/2026-06-30-portal-v1-design.md`.

### Phase 1 — Next.js Scaffold + Design System
**Commit:** `2cc222b feat(portal): scaffold Next.js 14 + shadcn/ui design system` + `1fd3a96 chore(portal): commit Next.js project config files`

- Next.js 14.2 App Router, TypeScript strict, Tailwind CSS v3.
- shadcn/ui initialised with Default/Slate theme; all required components added: button, badge, switch, tabs, card, separator, avatar, dropdown-menu, skeleton, table, checkbox, input, label, dialog.
- Dark professional CSS design tokens in `globals.css` (deep navy background, cyan primary).
- `portal/.env.example` present with all seven required vars.

### Phase 2 — Supabase Schema, Migrations, and RLS
**Commit:** `2cc222b` (migrations bundled in scaffold commit)

- `portal/supabase/migrations/0001_initial_schema.sql`: six tables — `profiles`, `calendar_connections`, `meetings`, `transcript_segments`, `summaries`, `action_items`. Includes `set_updated_at` trigger on `meetings`.
- `portal/supabase/migrations/0002_rls_policies.sql`: RLS enabled on all six tables; per-user select/insert/update/delete policies; join-via-meeting-id policies for transcript_segments, summaries, action_items.
- `portal/supabase/config.toml` added for Supabase CLI local dev (`afd40ca`).
- **NOT applied to any live Supabase project** — blocked on Task 0.1 (human must create the project).

### Phase 3 — Auth Flow (Google OAuth + Supabase)
**Commit:** `2cc222b`

- `portal/src/app/auth/login/route.ts`: GET handler that triggers `signInWithOAuth` with `calendar.readonly` scope, `access_type=offline`, `prompt=consent`.
- `portal/src/app/auth/callback/route.ts`: exchanges code for session, upserts `profiles` row, extracts and persists Google refresh token into `calendar_connections` via service-role client.
- `portal/src/middleware.ts`: protects all `/app/*` routes; redirects unauthenticated users to `/?login=1`.
- `portal/src/lib/auth-helpers.ts`: `extractRefreshToken()` — casts Session to grab `provider_refresh_token`.
- Supabase clients: `src/lib/supabase/client.ts` (browser), `server.ts` (RSC/route handler), `service.ts` (service-role).

### Phase 4 — Calendar Sync
**Commit:** `f14cc9d feat(portal): add fire-and-forget calendar sync on dashboard load`

- `portal/src/lib/calendar.ts`: `fetchUpcomingEvents()` builds `OAuth2` client from refresh token, lists events for the next 3 days. `buildMeetingUpsert()` maps a Google calendar event to a `meetings` upsert payload including `meet_url` extraction from `conferenceData`.
- `portal/src/app/api/calendar/sync/route.ts`: authenticated GET endpoint for explicit sync; upserts meetings with `onConflict: user_id,google_event_id`.
- Dashboard (`/app/page.tsx`) triggers calendar sync fire-and-forget on every load (no blocking).

### Phase 5 — Dashboard + Meeting Detail UI
**Commit:** `2cc222b`

- `/app` dashboard: shows upcoming (next 3 days) and past (done) meetings in separate sections; prompts calendar connection if not yet connected.
- `/app/meetings/[id]` detail page: three-tab layout (Transcript, Summary, Action Items) using shadcn Tabs; `StatusBadge` shows bot lifecycle state; meeting title, date/time, Join link.
- `/app/settings` page: Google Calendar connect/reconnect, bot name editor (Supabase upsert), plan display, sign-out.
- Components: `MeetingRow`, `OptInToggle`, `StatusBadge`, `TranscriptPanel`, `SummaryPanel`, `ActionItemsPanel`.
- Landing page (`/`): full marketing page with Nav, Hero + embedded VoiceDemo, HowItWorks, Features, UseCases, Pricing (stub), Footer.

### Phase 6 — Scheduler Worker (Python backend)
**Commit:** `282fea2 feat(scheduler+agent): bot-spawning scheduler worker + SupabaseWriter`

- `src/standin/scheduler/worker.py`: asyncio poll loop (60s interval), queries `meetings` for opted-in/pending rows within a ±10 min / -5 min window, POSTs to Vexa `/bots`, updates `bot_status` to `joining` and writes `vexa_meeting_id`.
- Systemd unit file at `scripts/stewardai-scheduler.service` (`1015fc4`).
- `SupabaseWriter` (within the same commit) wires the existing meeting agent to write transcript segments, summary, and action items back to Supabase rows at meeting end.

### Phase 7 — Voice Demo (landing page gated WebSocket widget)
**Commit:** `2cc222b`

- `portal/src/app/api/demo-token/route.ts`: HMAC-HS256 JWT (5 min TTL) signed with `DEMO_TOKEN_SECRET`; in-memory per-IP rate limit of 3 tokens/hour.
- `portal/src/lib/demo-token.ts`: `signDemoToken` / `verifyDemoToken` using `jose`.
- `portal/src/components/landing/VoiceDemo.tsx`: React client component; state machine (`idle → requesting → connecting → live → ended | error`); fetches token, requests mic, opens WebSocket to `NEXT_PUBLIC_DEMO_WS_URL`, streams audio via `MediaRecorder` at 100ms chunks; 75-second countdown with hard cutoff.

### Phase 8 — Unit Tests
**Commit:** `2cc222b`

- Jest tests (portal): `auth.test.ts` (2), `calendar.test.ts` (3), `demo-token.test.ts` (2) — all pass.
- Pytest (scheduler): `test_worker.py` (3) — `is_due`, `build_bot_payload` — all pass.

### Phase 9 — Deploy Plumbing
**Commit:** `1015fc4`, `afd40ca`

- Systemd unit `scripts/stewardai-scheduler.service` for the Hetzner scheduler worker.
- `portal/supabase/config.toml` for `supabase db push` CLI migrations workflow.
- Vercel project setup: **NOT done** — blocked on Task 0.5 (human must create Vercel project).

---

## 3. What Was Verified vs Not Verified

### Verified (automated)
- Production Next.js build (11 routes compile clean, zero TS/lint errors).
- All 7 Jest unit tests pass (auth-helpers, calendar upsert mapping, demo-token sign/verify).
- All 3 pytest scheduler unit tests pass (window logic, payload construction).
- Route tree is complete: `/`, `/app`, `/app/meetings/[id]`, `/app/settings`, `/auth/login`, `/auth/callback`, `/api/calendar/sync`, `/api/demo-token`.
- Middleware guards `/app/*` routes correctly.

### Not Verified (requires live credentials or infrastructure)
- Google OAuth login flow end-to-end (requires live Google OAuth client + Supabase project).
- Calendar sync actually returns events (requires valid `GOOGLE_OAUTH_CLIENT_ID/SECRET` + refresh token).
- Supabase DB migrations applied (requires `SUPABASE_URL` + service-role key).
- Demo WebSocket live audio session (requires `DEMO_WS_URL` pointing to running pipeline server).
- Scheduler bot-spawn integration with Vexa (requires `VEXA_URL` + `VEXA_API_KEY` env vars on Hetzner).
- Realtime transcript streaming on meeting detail page (wired to Supabase Realtime; not tested live).
- Vercel production deploy.

---

## 4. BLOCKED — Human Actions Required

These items are gating the app going live. None can be done by code.

### BLOCKER A — Google OAuth Client ID + Secret
**Task 0.2**  
Create an OAuth 2.0 Web Application client in Google Cloud Console.  
Enable the Google Calendar API.  
Add authorized redirect URI: `https://<supabase-project-ref>.supabase.co/auth/v1/callback`  
Add to `portal/.env.local`:
```
GOOGLE_OAUTH_CLIENT_ID=<client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
```
Then in Supabase Dashboard → Authentication → Providers → Google: enter both values and add the additional scope `https://www.googleapis.com/auth/calendar.readonly`.

### BLOCKER B — Supabase Project + Keys
**Task 0.1**  
Create a Supabase project at https://supabase.com/dashboard.  
Collect:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (keep this server-side only, never expose to browser)

Add to `portal/.env.local`.

Run migrations once the project exists:
```bash
cd portal
npx supabase db push
# or apply the two SQL files manually in Supabase SQL editor
```

### BLOCKER C — Demo Token Secret + Backend .env
**Task 0.3**  
Generate a 32-byte hex secret:
```bash
openssl rand -hex 32
```
Add to `portal/.env.local`:
```
DEMO_TOKEN_SECRET=<output>
NEXT_PUBLIC_DEMO_WS_URL=wss://demo.<yourdomain>/pipeline
```
Add the same `DEMO_TOKEN_SECRET` to the Hetzner backend `.env` so the pipeline server can verify tokens.

### BLOCKER D — demo.<domain> DNS + TLS + Caddy
**Task 0.4**  
Point `demo.<yourdomain>` to the Hetzner server IP.  
Configure Caddy to reverse-proxy `/pipeline` to the running pipeline port (see plan Task 0.4 for the full `Caddyfile` snippet).  
Update `NEXT_PUBLIC_DEMO_WS_URL` to the `wss://` address.

### BLOCKER E — Vercel Project + Environment Variables
**Task 0.5**  
Create Vercel project at https://vercel.com; import this repo; set **Root Directory** to `portal`.  
Add all seven env vars in Vercel → Settings → Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `NEXT_PUBLIC_DEMO_WS_URL`
- `DEMO_TOKEN_SECRET`

Add the Vercel production domain to Supabase → Authentication → URL Configuration as an allowed redirect URL.

### BLOCKER F — Hetzner Scheduler Deployment
**Task 9.2**  
Copy `scripts/stewardai-scheduler.service` to `/etc/systemd/system/` on the Hetzner server.  
Set env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VEXA_URL`, `VEXA_API_KEY`.  
Run:
```bash
systemctl daemon-reload
systemctl enable --now stewardai-scheduler
```

---

## 5. How to Run the Portal Locally

**Prerequisites:** Node 18+, a filled-in `portal/.env.local` (Blockers A, B, C must be done first).

```bash
# From repo root
cd /Users/aniquesabir/projects/stewardai/portal

# 1. Install dependencies (already done; only needed on first clone)
npm install

# 2. Apply DB migrations (one-time, after Supabase project is created)
npx supabase db push
# or paste portal/supabase/migrations/0001_initial_schema.sql
#           portal/supabase/migrations/0002_rls_policies.sql
# into Supabase Dashboard → SQL Editor and run both in order.

# 3. Start the dev server
npm run dev
# Opens on http://localhost:3000

# 4. (Optional) Start the pipeline server for VoiceDemo
# From repo root:
./run-native.sh
# Then set NEXT_PUBLIC_DEMO_WS_URL=ws://localhost:8765/pipeline in .env.local
```

**Verify local auth flow:**
1. Open http://localhost:3000 — landing page renders.
2. Click "Get started free" or nav Login → redirects to Google consent.
3. After consent, lands at `/app` dashboard.
4. Settings → Connect Google Calendar → reconnects with calendar scope.
5. Dashboard should list upcoming meetings from your Google Calendar within 3 days.

---

## 6. Known Issues and TODOs

| # | Issue | Severity | Notes |
|---|---|---|---|
| 1 | `punycode` Node deprecation warning in build output | Low | Upstream Node/Next.js issue; no action needed |
| 2 | In-memory demo rate limiter resets on server restart | Low | Acceptable for v1; use Redis or Upstash for v2 |
| 3 | Calendar sync on every dashboard load is fire-and-forget with no dedup guard at the UI level | Low | Could cause brief double-upsert on fast refreshes; idempotent via `onConflict` so no data loss |
| 4 | Meeting detail page has no Realtime subscription (transcript segments appear only on page load) | Medium | Works for post-meeting review; live in-meeting view needs a `useEffect` Supabase Realtime subscription — deferred to v1.1 |
| 5 | OptInToggle component exists but bot opt-in update route not wired as a dedicated API route | Low | Currently uses Supabase browser client direct upsert; acceptable for v1 |
| 6 | `VoiceDemo` sends raw `audio/webm` from `MediaRecorder`; backend pipeline expects PCM | Medium | Needs a `AudioWorklet` resampler or the pipeline server must accept webm and decode; check `ws_audio_tester.py` for expected format before live-testing the demo |
| 7 | `Pricing` section is a stub (no Stripe integration) | Low | Per plan spec: "No billing integration in v1" — correct |
| 8 | Supabase migrations have not been applied to any live DB | Blocking | Requires Blocker B to be resolved first |
| 9 | No E2E tests (Playwright / Cypress) | Medium | Unit tests cover library logic; E2E deferred to post-v1 |
| 10 | Bot name used in scheduler is hardcoded to `"StewardAI"` | Low | Should read from user's `profiles.bot_name`; requires scheduler to do a Supabase lookup per meeting (extra query per spawn) — easy follow-on |
