# Circleback-style Redesign — Design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)
**Surface:** `portal/` (Next.js 14 App Router product app under `/app/*`)

## Goal

Reshape the StewardAI product surfaces to match the UX of Circleback — clean,
meeting-centric, with clear information hierarchy across meetings, transcripts,
and action items. Remove the standalone Ask page (superseded by Chat) and fold
its capability into a per-meeting ask box plus the existing global Chat. Add a
light theme with a light/dark toggle (product defaults to light; the marketing
landing page is untouched).

## Non-goals (this pass)

- Public share links for meetings (needs new auth/token surface).
- Full-text server-side search across all meetings/transcripts.
- Restyling Chat, Spaces, or Settings beyond inheriting the new theme tokens.

## Decisions

- **Theme:** Light + dark toggle. Light is the default on product surfaces.
- **Scope:** Meetings surfaces restyle + a new global Action Items page + all
  four detail-page features (structured outline, action items with assignees,
  searchable speaker transcript, copy/export).
- **Ask:** Delete the page/nav; keep `lib/ask/client.ts`; reuse it for a
  per-meeting ask box. Global Chat remains the primary conversational surface.

## Architecture & Components

### 1. Navigation & routing

- **Delete:** `src/app/app/ask/page.tsx`, `src/components/ask/AskPanel.tsx`, and
  the "Ask" entry in `src/components/app-shell/Sidebar.tsx` (`NAV`).
- **Keep:** `src/lib/ask/client.ts` and its test — repurposed by the per-meeting
  ask box.
- **New nav order:** Chat · Meetings · Action Items (new) · Spaces ·
  Connected Apps · Usage · Settings.

### 2. Theming (light + dark)

- `src/app/globals.css`: add a **light palette** to `:root` (white background,
  near-black foreground, gray hairline borders; retain the teal `--primary`
  accent). Move the existing dark values under a `.dark` selector. Keep all
  existing HSL token names so no component needs restyling to keep working.
- `tailwind.config.ts`: confirm `darkMode: ["class"]` (add if absent).
- **ThemeProvider** (`src/components/app-shell/ThemeProvider.tsx`): a small
  client provider that reads/writes a `theme` cookie and `localStorage`, and
  toggles the `.dark` class on `<html>`. No external dependency (no next-themes).
- SSR: the `/app` layout reads the `theme` cookie and sets the initial class on
  the server to avoid a flash. Default is `light` when the cookie is absent.
- **Theme toggle** rendered in the sidebar footer next to `UserMenu`.

### 3. Home — meetings list (restyle)

- Keep `lib/meetings/series.ts` grouping (`SeriesCard` / `MeetingRow`).
- Restyle `MeetingRow` and `SeriesCard` to Circleback rows:
  - Left date column (compact, tabular).
  - Title (primary), then **attendee avatars** (reuse `SpeakerAvatar`), then a
    one-line summary (existing `tldr`), then a quiet status badge (`StatusBadge`).
  - Hairline dividers between rows, airy spacing, light cards.
- No data-flow change; `app/app/page.tsx` already fetches meetings + tldr.

### 4. Meeting detail (restructure)

`src/app/app/meetings/[id]/page.tsx` keeps its two-column layout. Content upgrades:

- **Header** (`MeetingHeader`): title · date/time · attendees · status, plus a
  **Copy** button and an **Export (Markdown)** button.
- **Left / main column:**
  - Structured **Overview** (`MeetingSummary`, already sectioned): Summary →
    Decisions → Open questions → Steward's actions.
  - **Action items** (`ActionItemsPanel`) upgraded with assignee chips, checkbox,
    and due date (mostly present; refine visual grouping).
  - **Ask about this meeting** (`MeetingAsk.tsx`, new): a compact input +
    answer thread powered by `lib/ask/client.ts`, scoped to this `meetingId`.
- **Right column — Transcript** (`MeetingTimeline`): add an **in-transcript
  search** box that filters/highlights matching segments client-side.

### 5. Global Action Items page (new)

- Route: `src/app/app/actions/page.tsx` (server component).
- Reads `action_items` joined to `meetings` (RLS-scoped `createServerClient`),
  for the current user, ordered by due/created.
- Groups into **Open** and **Done**; each item shows task · assignee chip ·
  due · a link to the source meeting.
- Checkboxes toggle `done` via the existing browser-client update pattern used
  in `ActionItemsPanel` (extract a shared `toggleActionDone` helper or a small
  client component `ActionItemsList`).

### 6. Copy / Export

- `src/lib/meetings/export.ts` (new): pure function
  `meetingToMarkdown(summary, actionItems, agentActions, meta)` → Markdown
  string. Unit-tested.
- Header buttons: **Copy** (clipboard) and **Download .md** (blob download),
  in a small client component `MeetingExportActions.tsx`.

## Data flow

- No schema changes. All reads use existing tables: `meetings`, `summaries`,
  `action_items`, `agent_actions`, `transcript_segments`, `meeting_entities`.
- Action Items page and toggles rely on existing RLS policies for
  `action_items`.
- Per-meeting ask reuses the existing ask endpoint via `lib/ask/client.ts`; if
  the client needs a meeting filter, pass `meetingId` through its existing
  request shape (verify during planning; extend minimally if needed).

## Error handling

- Empty states everywhere: no meetings, no action items (global + per-meeting),
  no transcript, no summary yet (reuse existing copy).
- Ask box: show inline error if the request fails; do not crash the page.
- Clipboard/export: guard `navigator.clipboard`; fall back to download.

## Testing

- `lib/meetings/export.test.ts`: Markdown rendering for full and sparse inputs.
- Extend `MeetingRow`/series rendering coverage if snapshot tests exist.
- Theme: a small test that the provider sets the `.dark` class from cookie.
- Global Action Items grouping: unit-test the open/done split + due sort if the
  grouping logic is extracted to `lib/meetings/actions.ts`.

## Rollout / risk

- Theme flip is the highest-visibility change; because token names are
  preserved, existing components keep working — only palette values change.
- Removing Ask is safe: Chat covers global Q&A and the per-meeting box covers
  meeting-scoped Q&A.
