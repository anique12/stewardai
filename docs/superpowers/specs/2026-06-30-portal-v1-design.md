# StewardAI Portal v1 — Design Spec

**Date:** 2026-06-30
**Status:** Approved design, ready for implementation plan
**Owner:** anique@propellus.co

---

## 1. Goal

Ship the first user-facing portal for **StewardAI**: a calendar-connected web app where users
log in, opt specific Google Calendar meetings in, and the StewardAI bot auto-joins those
meetings and produces a **transcript, summary, and action items** viewable in a dashboard. The
portal also includes a **content-rich public landing page** with a live "talk to StewardAI"
voice demo that reuses the existing backend `/pipeline` WebSocket.

The portal is a new Next.js app living at `portal/` inside the existing repo. The Python voice
agent + Vexa stack on Hetzner remain unchanged except for two small additions: (a) the agent
writes results (transcript segments, summary, action items, bot status) to Supabase, and (b) a
new lightweight scheduler worker polls Supabase for opted-in meetings and spawns the bot.

---

## 2. Scope

### In v1
- Public landing page (`/`): hero with live voice demo, how-it-works, features, use-cases,
  pricing stub, footer.
- Google OAuth (login + Calendar scope in a single consent flow, refresh token captured).
- Dashboard (`/app`): synced meetings list, per-meeting opt-in toggle, status badge.
- Meeting detail (`/app/meetings/[id]`): transcript, summary, action items, live updates.
- Settings (`/app/settings`): reconnect calendar, edit bot name, plan display, sign out.
- Onboarding redirect: first login → connect calendar → dashboard.
- Backend scheduler worker (new Python script on Hetzner) polls opted-in meetings → spawns bot.
- Agent writes results to Supabase (new side-effect added to the existing agent).
- Landing voice demo: reuses `/pipeline` ws; gated with session token + time cap + rate limit.

### Deferred (not in v1)
- Real billing / Stripe.
- AI avatars or custom bot video (Vexa capability check required first).
- Google Calendar push webhooks + event-driven durable scheduling (v2 orchestration).
- Observability (Langfuse) + evals harness.

---

## 3. Architecture

### 3.1 Three tiers

```
┌─────────────────────────────────────────────┐
│  Vercel (Next.js App Router)                │
│  portal/                                    │
│  ├── / (public landing + voice demo)        │
│  ├── /app/* (auth-gated dashboard)          │
│  └── /api/* (route handlers: calendar sync, │
│               demo token issuer)            │
└──────────────┬──────────────────────────────┘
               │  reads/writes via supabase-js client
               ▼
┌─────────────────────────────────────────────┐
│  Supabase (Auth + Postgres + Realtime)      │
│  ├── auth.users (managed by Supabase Auth)  │
│  ├── profiles, calendar_connections         │
│  ├── meetings (opt-in + bot_status)         │
│  ├── transcript_segments, summaries,        │
│  │   action_items                           │
│  └── Realtime channels on meetings +        │
│      transcript_segments                    │
└──────────────┬──────────────────────────────┘
               │  service-role key (bypasses RLS)
               ▼
┌─────────────────────────────────────────────┐
│  Hetzner (existing Python backend)          │
│  ├── voice agent + Vexa stack (unchanged)   │
│  ├── NEW: agent writes results to Supabase  │
│  └── NEW: scheduler worker (polls every ~1m)│
│      → Vexa POST /bots + agent spawn        │
└─────────────────────────────────────────────┘
```

### 3.2 Poll-based orchestration seam

The portal owns calendar sync (it has the Google OAuth refresh token). The backend owns bot
orchestration (it has the Vexa credentials and can start agents). The two sides are **decoupled
through Supabase**:

1. A Next.js cron route handler (or server action on a timer) calls Google Calendar API with the
   stored refresh token, upserts upcoming events into `meetings`.
2. The user flips `meetings.opted_in = true` on the dashboard.
3. The backend scheduler worker (Python, running on Hetzner as a `systemd` service) runs a
   tight loop: `SELECT … FROM meetings WHERE opted_in = true AND bot_status = 'pending' AND
   start_time BETWEEN now() - interval '5 minutes' AND now() + interval '10 minutes'`. For each
   row it POSTs to Vexa `POST /bots`, sets `bot_status = 'joining'`, then spawns the agent
   process pinned to `vexa_meeting_id`.
4. The agent updates `bot_status` and appends `transcript_segments` / `summaries` /
   `action_items` to Supabase via the service-role key.
5. The portal subscribes to Supabase Realtime on the `meetings` and `transcript_segments` tables
   for the current user's rows, so the dashboard and meeting-detail page update live.

**The backend never needs to touch Google tokens.** The portal never needs Vexa credentials.

### 3.3 Landing voice demo data flow

```
Browser mic (getUserMedia)
  └─ WebSocket → demo.<domain> (TLS, Cloudflared or Caddy)
       └─ backend /pipeline ws (STT → LLM → TTS → audio back)
```

The Next.js `/api/demo-token` route handler issues a short-lived HMAC-signed JWT (secret shared
with the backend) before the browser can connect. The backend validates it on WS handshake.

---

## 4. Data Model

All tables are in the `public` schema. RLS is enabled on every table. The backend uses the
`service_role` key which bypasses RLS. Portal client uses the `anon` key + user JWT (RLS
enforces row ownership).

### 4.1 `profiles`

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` PK | FK → `auth.users(id)` ON DELETE CASCADE |
| `display_name` | `text` | |
| `bot_name` | `text` | default `'StewardAI'` |
| `plan` | `text` | default `'free'`; check in `('free','pro')` |
| `created_at` | `timestamptz` | `now()` |

**RLS:** `SELECT/UPDATE WHERE user_id = auth.uid()`.
**Who writes:** portal upserts on first login (trigger on `auth.users` insert).

### 4.2 `calendar_connections`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users(id)` ON DELETE CASCADE, UNIQUE |
| `google_refresh_token` | `text` | encrypted at rest (Supabase vault or app-level) |
| `scopes` | `text[]` | e.g. `'{calendar.readonly,userinfo.email}'` |
| `connected_at` | `timestamptz` | `now()` |

**RLS:** `SELECT/INSERT/UPDATE WHERE user_id = auth.uid()`.
**Who writes:** portal OAuth callback route handler, via service-role (to avoid exposing the
token to the browser at all).

### 4.3 `meetings`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users(id)` ON DELETE CASCADE |
| `google_event_id` | `text` | from Google Calendar API |
| `title` | `text` | |
| `start_time` | `timestamptz` | |
| `end_time` | `timestamptz` | |
| `meet_url` | `text` | nullable (event may not have a Meet link yet) |
| `native_meeting_id` | `text` | nullable; Vexa's internal room id once known |
| `opted_in` | `bool` | default `false` |
| `bot_status` | `text` | check in `('pending','joining','in_meeting','done','failed')`, default `'pending'` |
| `vexa_meeting_id` | `uuid` | nullable; Vexa-assigned meeting id returned by POST /bots |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | `now()`, updated by trigger |
| UNIQUE | | `(user_id, google_event_id)` |

**RLS:** `SELECT/UPDATE WHERE user_id = auth.uid()` (for portal). Backend uses service-role to
update `bot_status`, `vexa_meeting_id`, `native_meeting_id`.

### 4.4 `transcript_segments`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `meeting_id` | `uuid` | FK → `meetings(id)` ON DELETE CASCADE |
| `seq` | `int` | turn sequence number, 0-indexed |
| `speaker` | `text` | speaker label (diarization from Vexa) |
| `text` | `text` | turn text |
| `created_at` | `timestamptz` | `now()` |

**RLS:** `SELECT WHERE meeting_id IN (SELECT id FROM meetings WHERE user_id = auth.uid())`.
**Who writes:** backend agent appends turn-by-turn via service-role.

### 4.5 `summaries`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `meeting_id` | `uuid` | FK → `meetings(id)` ON DELETE CASCADE, UNIQUE |
| `tldr` | `text` | |
| `decisions` | `jsonb` | array of `{text: string}` |
| `discrepancies` | `jsonb` | array of `{text: string}` |
| `created_at` | `timestamptz` | `now()` |

**RLS:** same as `transcript_segments` (join through `meetings`).
**Who writes:** backend agent once, after meeting ends, via service-role.

### 4.6 `action_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `meeting_id` | `uuid` | FK → `meetings(id)` ON DELETE CASCADE |
| `owner` | `text` | person responsible |
| `task` | `text` | description |
| `due` | `date` | nullable |
| `done` | `bool` | default `false` |
| `created_at` | `timestamptz` | `now()` |

**RLS:** same as `transcript_segments`.
**Who writes:** backend agent (inserts), portal user (UPDATE `done = true` on their own rows via
`auth.uid()` check through `meetings` join).

---

## 5. Surfaces & Screens

### 5.1 Landing (`/`)

Sections top to bottom:

| Section | Content |
|---|---|
| `Nav` | Wordmark, anchor links (How it works · Features · Pricing), "Sign in" and "Get started" CTAs |
| `HeroDemo` | **Centerpiece:** live voice demo widget + headline + subhead. Widget shows "Talk to StewardAI" button (explicit click, no autoplay). On click: mic permission → WS connect → audio in/out. 60–90s cap with sign-up CTA on expiry. |
| `HowItWorks` | 3 steps: Connect your calendar → Toggle a meeting → Get transcript + summary + actions |
| `Features` | 4+ cards: named diarization, AI summary, action items, calendar-driven auto-join |
| `UseCases` | 3 use-case vignettes (sales calls, engineering stand-ups, client check-ins) |
| `Pricing` | Stub tiers: Free (3 meetings/mo) · Pro ($X/mo, unlimited). "Start free" CTA. No billing integration. |
| `Footer` | Wordmark, copyright, sign-in link |

### 5.2 Auth (`/auth/callback`)

Supabase Auth handles the Google OAuth redirect. The Next.js callback route:
1. Exchanges the code for session + tokens via `@supabase/ssr`.
2. Extracts and persists the Google refresh token to `calendar_connections` via service-role
   (never exposed to the browser).
3. Upserts `profiles` row for the user.
4. Redirects to `/app` (or `/app/settings?connect=calendar` if this is a first login without
   calendar scope).

### 5.3 Dashboard / Meetings (`/app`)

Auth-gated. Empty state if no `calendar_connections` row → CTA to connect calendar (links to
`/app/settings`).

When connected:
- Calendar sync runs server-side (Next.js route handler or Server Action calls Google Calendar
  API with stored refresh token → upserts to `meetings`).
- **Upcoming meetings** rendered as a list: title, time, Meet URL chip, `opted_in` toggle
  (checkbox/switch), `bot_status` badge (`pending` · `joining` · `in_meeting` · `done` ·
  `failed`).
- **Past meetings** (where `bot_status = 'done'`): title, time, link to meeting detail.
- Realtime subscription on `meetings` (current user's rows) keeps status badges live.

### 5.4 Meeting Detail (`/app/meetings/[id]`)

Three tabs / collapsible panels:

| Panel | Content |
|---|---|
| Transcript | Chronological speaker-labeled turns from `transcript_segments`, ordered by `seq`. Live-appends via Supabase Realtime while `bot_status = 'in_meeting'`. |
| Summary | TL;DR paragraph, decisions list, discrepancies list. Appears once `summaries` row exists. |
| Action Items | Table: owner · task · due · done checkbox. `done` is togglable by the user. |

Header shows: meeting title, start/end time, `bot_status` badge, Meet URL link.

### 5.5 Settings (`/app/settings`)

- **Calendar connection**: shows connected email + connected date if `calendar_connections` row
  exists; "Connect Google Calendar" or "Reconnect" button (re-runs the OAuth flow with Calendar
  scope).
- **Bot name**: editable text field, saved to `profiles.bot_name`.
- **Plan**: reads `profiles.plan`, shows tier label. "Upgrade" button is a stub (no action in v1).
- **Sign out**: calls `supabase.auth.signOut()` + redirects to `/`.

### 5.6 Onboarding

First login with no `calendar_connections` row → redirect to `/app/settings?connect=calendar`
with a banner: "Connect your Google Calendar to get started." After successful OAuth callback
the user lands on `/app`.

---

## 6. Landing Voice Demo — Detail

### 6.1 Reuse

The demo reuses the existing backend `/pipeline` WebSocket endpoint unchanged (except the
backend must validate the session token, described below). The frontend sends raw PCM audio and
receives TTS audio back — the same protocol the existing `/pipeline` client uses.

A **`demo.<domain>` subdomain** (human-configured) provides a public TLS WebSocket URL routed
to the Hetzner backend `/pipeline` ws. Cloudflared Tunnel or Caddy reverse-proxy (human-set-up)
handles TLS termination.

### 6.2 Persona

The demo agent runs with `gated=False` and a demo-specific system prompt: friendly, concise,
showcases listen/answer/summarize capability, and nudges the user toward signing up when the
session ends or on queries about pricing/access.

### 6.3 Gating (5 layers)

1. **Session token**: `GET /api/demo-token` (Next.js route handler, server-side) issues a
   short-lived (5-min) HMAC-signed JWT. The browser passes it as a query parameter on the WS
   URL. The backend validates the signature before upgrading the connection. Token is single-use
   (backed by an in-memory or Redis set on the backend).
2. **Time cap**: The backend closes the WS after 60–90 seconds of session time. The frontend
   shows a graceful end screen with a sign-up CTA.
3. **Per-IP rate limit**: Next.js `/api/demo-token` route handler enforces max 3 tokens/hour per
   IP using an in-memory LRU (or Vercel KV in later iterations). Returns 429 if exceeded.
4. **Concurrency cap**: The backend maintains a counter of active `/pipeline` demo sessions; if
   ≥ N (configurable, e.g. 5), `/api/demo-token` returns 503 (checked via a lightweight HTTP
   health endpoint the backend exposes).
5. **Explicit click**: The "Talk to StewardAI" button requires a user gesture before
   `getUserMedia()` is called. No autoplay, no ambient audio capture.

---

## 7. External Setup Prerequisites (Human)

These steps must be completed by a human before any deployment can work. They are not
automatable via code. **They block all later phases.**

### 7.1 Supabase Project
- Create a new Supabase project at https://supabase.com/dashboard.
- Note the **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`), **anon key**
  (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), and **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`).
- Enable the **Google Auth provider** in Supabase Dashboard → Auth → Providers → Google. This
  requires the Google OAuth credentials from step 7.2.
- Set the Supabase Auth redirect URL: `https://<your-domain>/auth/callback` (and
  `http://localhost:3000/auth/callback` for local dev).

### 7.2 Google Cloud OAuth App
- Create (or reuse) a project at https://console.cloud.google.com.
- Enable the **Google Calendar API** in APIs & Services → Library.
- Create an **OAuth 2.0 Client ID** (Web application type).
- Add authorized redirect URIs:
  - `https://<your-supabase-project>.supabase.co/auth/v1/callback` (Supabase handles the
    OAuth dance)
  - `http://localhost:54321/auth/v1/callback` (local Supabase CLI)
- Note the **Client ID** (`GOOGLE_OAUTH_CLIENT_ID`) and **Client Secret**
  (`GOOGLE_OAUTH_CLIENT_SECRET`).
- Scopes to request (set in Supabase Google provider config):
  - `openid`, `email`, `profile`
  - `https://www.googleapis.com/auth/calendar.readonly`

### 7.3 Vercel Project
- Create a Vercel project linked to the repo, pointing at the `portal/` subdirectory (set
  **Root Directory** to `portal` in project settings).
- Add all env vars (see §7.5) in Vercel Dashboard → Settings → Environment Variables.
- Set the **Production domain** (e.g. `app.stewardai.dev`).

### 7.4 Domain + Demo Subdomain TLS
- Point the main domain (e.g. `stewardai.dev`) to Vercel.
- Create a `demo.stewardai.dev` CNAME or A record pointing to the Hetzner server IP.
- On Hetzner, configure a **reverse proxy** (Caddy or Cloudflared Tunnel) to:
  - Terminate TLS for `demo.stewardai.dev`.
  - Forward WebSocket traffic to `localhost:<pipeline_port>/pipeline`.
- Verify: `wss://demo.stewardai.dev/pipeline` is reachable with a valid cert.

### 7.5 Environment Variables

**Vercel (portal, server-side):**
```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
GOOGLE_OAUTH_CLIENT_ID=<client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
DEMO_WS_URL=wss://demo.stewardai.dev/pipeline
DEMO_TOKEN_SECRET=<random-32-byte-hex>    # shared with backend
```

**Hetzner backend (agent + scheduler):**
```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DEMO_TOKEN_SECRET=<same-32-byte-hex>      # shared with portal
```

**Local dev (portal/.env.local):**
```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local-anon-key>   # from supabase start output
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
GOOGLE_OAUTH_CLIENT_ID=<client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
DEMO_WS_URL=ws://localhost:<pipeline_port>/pipeline
DEMO_TOKEN_SECRET=dev-secret-not-for-production
```

---

## 8. Design System

**Tailwind CSS v3 + shadcn/ui** (owned component code). Design tokens committed first so the
result reads intentional rather than templated.

Visual direction: dark professional. Midnight navy/charcoal base, single electric accent
(teal/indigo), generous whitespace, subtle glass-card surfaces, crisp typography. Not minimal —
content-rich sections on the landing page.

shadcn/ui components used: `Button`, `Badge`, `Switch`, `Tabs`, `Dialog`, `Card`,
`Separator`, `Avatar`, `DropdownMenu`, `Skeleton`, `Table`, `Checkbox`, `Input`, `Label`.

---

## 9. Tech Stack Summary

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Auth + DB | Supabase (Auth + Postgres + Realtime + Storage) |
| Supabase client | `@supabase/ssr` (server components + route handlers) |
| Google API | `googleapis` npm package (calendar sync in route handler) |
| Deployment | Vercel |
| Backend | Existing Python on Hetzner (unchanged except new Supabase writes) |
| Demo WebSocket | Existing `/pipeline` ws endpoint, new TLS proxy + session token gating |

---

## 10. Non-Goals (v1)

- No billing, no Stripe.
- No push webhooks from Google (polling-only calendar sync).
- No email notifications.
- No multi-workspace or team accounts.
- No mobile app.
- No observability stack (Langfuse, evals).
