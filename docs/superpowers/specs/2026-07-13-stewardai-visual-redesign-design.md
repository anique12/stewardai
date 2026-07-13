# StewardAI Visual Redesign — Design Spec

**Date:** 2026-07-13
**Source design:** `StewardAI.dc.html` (Claude Design project "StewardAI Visual System Design", `cd5f34b7-…`)
**Scope decision:** full app reskin, all screens, single review at the end.

## 1. Goal & non-goals

**Goal.** Re-skin the authenticated StewardAI portal to match the `StewardAI.dc.html` design — a warm "paper" visual system (cream surfaces, deep-green brand, amber/terracotta accents, three typefaces) across every in-app screen, in both light and dark themes — and make the small set of functional changes the design implies (new Home dashboard, split-out Meetings list, ⌘K search, nudges, chat scope).

**Non-goals / hard constraints.**
- **The landing/marketing pages and legal pages are NOT changed.** `src/app/page.tsx`, `src/components/landing/*`, `/privacy`, `/terms`, `/cookies`, `/trust` keep their current teal-on-white look and their `.accent-text`/`.bg-grid`/`.waveform-bar` styling. The new palette is **scoped to the app**, never applied at `:root`.
- No backend rewrite. We reuse the existing Supabase tables, API routes, and chat WebSocket. New backend work is limited to a small search endpoint and one optional chat-scope field (§8).
- No billing/payments integration.

## 2. Design token foundation

The design defines a full token system (`StewardAI.design.html` `:root` / `[data-theme="dark"]`). Current app tokens are Circleback teal (`portal/src/app/globals.css`). We introduce the new palette **without touching `:root`/`.dark`** (which the landing depends on).

### 2.1 Scoping mechanism

- The app root element (rendered by `src/app/app/layout.tsx`, and the auth/onboarding screens) gets a scope class, e.g. `class="steward-app"`, plus the existing `data-theme`/`.dark` mechanism.
- In `globals.css` we add:
  - `.steward-app { …warm light token values… }` — overrides every shadcn semantic token (`--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`) with the paper-palette equivalents, **and** defines the extended tokens (below).
  - `.dark .steward-app { …warm dark token values… }` — the dark variant.
- `:root` and `.dark` are left exactly as they are → landing unaffected.
- Because shadcn `ui/*` components consume `hsl(var(--token))`, they automatically render in the warm palette inside `.steward-app` with **no per-component change** for the base tokens.

### 2.2 Token mapping (design → existing shadcn semantic token)

Restyling reuses existing utility classes wherever a semantic token already exists:

| Design token | Value (light / dark) | Maps to shadcn token → utility |
|---|---|---|
| `--paper` | `#f4f1ea` / `#131310` | `--background` → `bg-background` |
| `--surface` | `#fffdf8` / `#1c1b16` | `--card`, `--popover` → `bg-card` |
| `--ink` | `#1b1a15` / `#f3f0e7` | `--foreground` → `text-foreground` |
| `--brand` | `#2c6b58` / `#57b899` | `--primary`, `--accent`, `--ring` → `bg-primary`/`text-primary`/`ring` |
| `--on-brand` | `#f7fbf8` / `#0c1b16` | `--primary-foreground` |
| `--surface-2` | `#ece8df` / `#242219` | `--secondary`, `--muted` → `bg-secondary`/`bg-muted` |
| `--ink-3` | `#8b8676` / `#847f70` | `--muted-foreground` → `text-muted-foreground` |
| `--line` | `#e4dfd3` / `#2c2a21` | `--border`, `--input` → `border-border` |
| `--danger` | `#a63a28` / `#e88a72` | `--destructive` → `bg-destructive`/`text-destructive` |

Semantic HSL triplets for the shadcn subset are computed from these hex values (rounding acceptable).

### 2.3 Extended tokens (no shadcn equivalent — add as raw custom properties + Tailwind utilities)

Defined under `.steward-app` (+ dark override) and mapped in `tailwind.config.ts` `theme.extend.colors` as raw `var(--x)` values (full colors, not `hsl()`-wrapped):

- Surfaces/ink: `--surface-3`, `--ink-2`, `--ink-4`, `--line-2`, `--line-strong`.
- Brand family: `--brand-2`, `--brand-ink`, `--brand-weak`, `--brand-weak-2`.
- Attention (amber): `--attention`, `--attention-strong`, `--attention-weak`, `--on-attention`.
- Danger extras: `--danger-strong`, `--danger-weak`, `--on-danger`.
- Utilities: `text-ink-2`, `text-ink-4`, `bg-surface-3`, `border-line-2`, `border-line-strong`, `bg-brand-weak`, `text-brand-ink`, `bg-attention`, `text-attention-strong`, `bg-attention-weak`, `bg-danger-weak`, etc.

Shadows and radii:
- Radii scale added to `borderRadius`: `xs 4px`, `sm 6px`, `DEFAULT/md 9px`, `lg 13px`, `xl 18px`, `pill 999px`. (Note: this **changes** the app radius scale; landing is unaffected because it uses its own classes and lives outside `.steward-app` — verify no shared `ui/*` radius regression on landing, which does not render `ui/*` primitives inside `.steward-app`.)
- Box-shadows added to `boxShadow`: `sh-1`, `sh-2`, `sh-pop` (light + dark values via tokens `--sh-1/2/pop`).
- `--scrim` for dialog backdrops.

### 2.4 Fonts (self-hosted, matching current pattern)

The design uses Bricolage Grotesk (display), Hanken Grotesk (UI), IBM Plex Mono (mono) — all OFL/open-source. Following the existing self-host pattern (`layout.tsx` uses `next/font/local` to avoid build-time Google fetches):
- Download woff2 files into `portal/src/app/fonts/` (a small fetch script under `scripts/` or manual).
- Register via `next/font/local` exposing `--font-display`, `--font-ui`, `--font-mono-plex`.
- Apply **inside `.steward-app` only**: body text → Hanken (`--font-ui`), headings/display → Bricolage (`--font-display`), mono → IBM Plex Mono. Root `--font-sans`/`--font-mono` (Inter/Geist) remain for landing.
- If a font is unavailable offline, fall back to the existing `--font-sans`/system stack and note it; do not block the build.

### 2.5 Animations

Port the design keyframes into `globals.css` utilities (all reduced-motion aware): `pulse`, `ring` (live indicator), `fadeUp` (popovers/sheets), `toastIn`, `checkPop`, `shimmer` (skeletons), `spin`. Reuse existing `ui/skeleton` for skeleton loaders, restyled to the shimmer look.

## 3. App shell

`src/components/app-shell/*` + `src/app/app/layout.tsx`.

- **Sidebar** (desktop, 252px): wordmark w/ Steward mark + "Personal agent"; prominent **Ask Steward** primary button (→ `/app/chat`); grouped nav — **Workspace**: Home, Meetings (live-dot when a meeting is in progress), Action items (open-count badge), Spaces (review-count badge); **Account**: Connected apps, Usage, Settings; footer account button opening a menu (Settings / Usage & billing / switch theme / Sign out).
- **Topbar** (`PageHeader` replacement/extension): page title + subtitle, desktop ⌘K search button (270px), **Instant join** button, **Nudges** bell w/ count, theme toggle. Title/subtitle are per-route.
- **Mobile**: top bar with hamburger → left drawer (grouped nav + account); **bottom nav** (Home / Ask / Meetings / Actions / Spaces). Both restyled to the paper palette.
- The shell owns global overlays: ⌘K **search palette**, **instant-join** dialog, **nudges** panel, **new-space** dialog, and a **toast** host. These become shared client components (e.g. `components/app-shell/CommandPalette.tsx`, `NudgesPanel.tsx`, `InstantJoinDialog.tsx`, existing `NewSpaceDialog` restyled, `Toast`).

## 4. Routing changes

| Route | Today | After |
|---|---|---|
| `/app` | Meetings home (upcoming/past) | **Home dashboard** (new) |
| `/app/meetings` | — (none) | **Meetings list** (Upcoming/Past tabs + live card) — new page reusing existing meeting data + `lib/meetings/series.ts` |
| `/app/meetings/[id]` | Meeting detail | Meeting detail (restyled) |
| `/app/chat` | Chat | Chat (restyled) |
| `/app/spaces`, `/spaces/[id]`, `/spaces/unfiled` | as-is | restyled |
| `/app/actions` | Action items | restyled (buckets + stat strip) |
| `/app/settings`, `/settings/connections` | as-is | restyled |
| `/app/usage` | Usage | restyled (stat tiles + bar chart) |

Sidebar "Meetings" now points to `/app/meetings`; "Home" → `/app`.

## 5. Per-screen spec

For each: **restyle** existing UI to the design, wire the design's states to existing data, and apply the stub decisions (§7). All screens support loading / empty / error / populated states from the design.

1. **Home dashboard (`/app`) — NEW.** Greeting (name + date + "covering N meetings today" + open-action count); Ask-Steward bar (→ chat) with suggestion chips; two-column: left = Today's agenda (today's meetings from `meetings`) + Recent recaps (`summaries`); right = Needs-action (`action_items`, top few open) + Review-queue banner (unfiled count) + Spaces pulse (open-fact counts per space). Data all exists; assemble in the server component.
2. **Meetings (`/app/meetings`) — NEW page, existing data.** Upcoming/Past tabs; "Happening now" live card when a meeting `bot_status='in_meeting'` (link to live transcript); grouped upcoming (Today/Tomorrow/…) via `series.ts`; per-row opt-in `Switch`, platform chip, attendee avatars (derived from speakers/entities), space chip, status pill; Past = list w/ summary line + action count + status.
3. **Meeting detail — restyle.** Header (title, status pill, date/time/duration/platform, Completed/Live toggle); meta chips (attendee avatars, changeable space picker, tags, entities); two-column transcript (named speakers incl. "Steward — spoke in room", search, live poll) + recap rail (Summary, Decisions, Open questions/risks, Action items, **What Steward did** = `agent_actions` w/ approve/dismiss). Mobile tab switch (Transcript/Recap). States incl. bot-failed error + scheduled-empty.
4. **Chat — restyle.** Thread history rail (+ mobile sheet), reasoning/tool trace (friendly labels/icons already exist), answer w/ bullets + citation chips → meeting, and the three agentic cards: **approve-with-preview** (email draft; existing `PermissionCard`), **connect-app** (existing `ConnectCard`), **reversible-action receipt** (restyle; **Undo hidden** per §7). Composer with **scope selector** (§8) and send.
5. **Spaces overview — restyle.** Review-queue backstop banner; grid of group cards (nested children) + leaf cards (avatars, open-count, updated). Uses `buildSpaceTree`.
6. **Space detail — restyle.** Breadcrumb; header (stats, "Ask about this space" → chat); **State-of-thread brief hidden/deferred** per §7; What's-known fact groups w/ citations (`space_facts`); Meetings filed here; right rail Companies + People (`entities`).
7. **Review queue (`/spaces/unfiled`) — restyle.** Per-meeting card w/ confidence badge (`space_confidence`), **File to <suggested>** confirm, **Pick another** menu, **File to new space**. Uses existing `FileMeetingControl` logic.
8. **Action items — restyle.** Stat strip (Open / Overdue / Due today / Completed — derived from `action_items.due`+`done`); Open/Completed/All tabs; buckets by due; owner avatars + due pills; checkbox toggles `done`.
9. **Connected apps — restyle.** Search + category pills; Connected / Available / Coming-soon sections (`catalog.ts`); connect/disconnect (existing routes).
10. **Usage — restyle.** Range toggle (7/30/90d — 30d works today; 7/90 adjust the query window); stat tiles; "Meetings processed per week" stacked bar (aggregate `usage_logs`); per-feature cost table; total row.
11. **Settings — restyle.** Calendar connection (reconnect), **Assistant name / wake word** (single `bot_name` field, labeled per design), **Plan** card (**Manage plan disabled** per §7), Appearance (light/dark picker → theme), Account + Sign out.
12. **Auth / onboarding — restyle.** Split brand pane + form; steps Sign in (Google) → Connect calendar → Done. Backed by existing Google OAuth + calendar connect.

## 6. Component/primitive updates

- `ui/*` primitives (button, card, dialog, dropdown-menu, input, switch, tabs, badge, checkbox, skeleton, avatar, separator, table) are restyled via the scoped tokens — mostly automatic; adjust variants (radius, shadow, brand hover) as needed so they match the design's button/card treatments.
- Shared new pieces: `StatusPill`, `SpaceChip`, `PlatformChip`, `SectionCard`, `EmptyState`, `ErrorState`, `SkeletonBlock`, `CommandPalette`, `NudgesPanel`, `InstantJoinDialog`, `Toast` — small, single-purpose, colocated under `components/app-shell` or a new `components/common`.

## 7. Stubbed / deferred (visual-only, per user decision "build subset, stub rest")

- **Billing / Plan** — render the Plan card exactly as designed; **"Manage plan"/"Upgrade" disabled** with a "coming soon" affordance. No payment flow.
- **Zoom / Teams join** — instant-join accepts Meet/Zoom/Teams URLs (existing parser) but only **Google Meet** actually joins; keep platform chips in the UI. A short note in the instant-join dialog that non-Meet is best-effort.
- **Email Undo** — the "Undo" control on the approved-email receipt is **omitted** (Gmail send isn't reversible). Reversible internal-op receipts render without Undo too (no undo endpoint today).
- **Space "State of this thread" narrative brief** — **hidden/deferred**; the fact groups already convey state. (Revisit if we add a space-summary generation pass.)

## 8. New / changed backend (small)

- **⌘K search** — new `GET /api/search?q=` returning meetings, people/companies (`entities`), spaces, and action items matching the query (simple `ilike`/RAG-lite over Supabase, RLS-scoped). Powers the search palette.
- **Nudges (derived)** — computed from existing data (overdue `action_items`, meetings needing filing, bot-failed meetings). Either a `GET /api/nudges` endpoint or server-side assembly in the shell. No new proactive engine.
- **Chat scope** — composer scope selector (All work / a Space / a Meeting). Minimal implementation: prepend a scope hint to the user message text sent over the existing WS (no protocol change required); optionally add a `scope` field later if the agent should hard-constrain retrieval. Ship the prompt-prefix version now.

## 9. Testing & verification

- Type-check + lint (`next lint`, `tsc`) and existing `jest` suite must pass.
- Manual/drive verification per screen in **both light and dark**, and at desktop + mobile widths, covering loading/empty/error/populated where the route supports them.
- **Landing regression check:** confirm `/`, `/privacy`, `/terms`, `/cookies`, `/trust` render visually identical to before (palette, fonts, hero animations) — the scope boundary must hold.
- Verify no `ui/*` primitive used by landing regresses from the added radius/shadow scale.

## 10. Structure / isolation notes

- Keep the token layer (globals.css + tailwind.config) as the single source of visual truth; screens consume utilities, not hex.
- New pages (`/app` dashboard, `/app/meetings`) are thin server components that assemble already-available data via existing `lib/*` helpers; add `lib/home/*` and reuse `lib/meetings/series.ts`.
- Overlays (search/nudges/instant-join/toast) live in the shell and are driven by lightweight client state; avoid a global store.
- Each restyle stays within its existing route/component boundary; no unrelated refactors.
