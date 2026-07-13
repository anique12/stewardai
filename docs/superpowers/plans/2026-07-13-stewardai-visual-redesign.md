# StewardAI Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the authenticated StewardAI portal to the `StewardAI.dc.html` "paper" design system across all in-app screens (light + dark, desktop + mobile), leaving the landing/legal pages untouched.

**Architecture:** Introduce the new palette as CSS custom properties scoped to a `.steward-app` wrapper (never at `:root`), so shadcn `ui/*` primitives inherit it automatically. Add extended tokens + a radius/shadow scale in `tailwind.config.ts`. Self-host three new fonts. Restyle each screen to its design section; add a new Home dashboard and a split-out Meetings list; build ⌘K search, derived nudges, and a chat scope prefix; visually stub billing/Zoom-Teams/email-undo/space-brief.

**Tech Stack:** Next.js App Router, Tailwind CSS, shadcn/Radix primitives, Supabase (server/service clients), Composio, chat WebSocket, `next/font/local`.

**Design source of truth:** `/private/tmp/claude-501/-Users-aniquesabir-projects-stewardai/c6017ab8-215b-408e-abe2-d898f0cfce2b/scratchpad/StewardAI.design.html` (clean HTML export). Line ranges below reference this file. Re-export from the Design MCP if the scratchpad is gone (project `cd5f34b7-f72b-4243-b1f0-0717c1ca8366`, file `StewardAI.dc.html`).

**Spec:** `docs/superpowers/specs/2026-07-13-stewardai-visual-redesign-design.md`.

## Global Constraints

- **Do NOT modify** `src/app/page.tsx`, `src/components/landing/*`, `src/app/{privacy,terms,cookies,trust}/*`, or `:root`/`.dark` blocks in `globals.css`. The new palette applies ONLY under `.steward-app`.
- All new palette tokens live under `.steward-app` (light) and `.dark .steward-app` (dark).
- shadcn semantic tokens keep the `hsl(var(--token))` contract; extended tokens are raw color `var(--token)`.
- Fonts self-hosted via `next/font/local` (no build-time Google fetch); graceful fallback to `--font-sans` if a file is missing.
- Reuse existing data/APIs; new backend limited to `GET /api/search`, nudges derivation, and a chat scope prefix (no WS protocol change).
- Every screen must render its design states (loading/empty/error/populated) where the route already produces them.
- After each task: `cd portal && npm run lint` and `npx tsc --noEmit` must pass; commit.

---

### Task 1: Token foundation — globals.css scope + tailwind config + fonts

**Files:**
- Modify: `portal/src/app/globals.css` (append scoped blocks; do NOT touch `:root`/`.dark`)
- Modify: `portal/tailwind.config.ts`
- Modify: `portal/src/app/app/layout.tsx` (add `.steward-app` wrapper + fonts)
- Create: `portal/scripts/fetch-design-fonts.sh` (font download helper)
- Add font files: `portal/src/app/fonts/{BricolageGrotesk,HankenGrotesk}.woff2`, `IBMPlexMono.woff2`

**Interfaces:**
- Produces: `.steward-app` scope with all shadcn tokens remapped + extended tokens; Tailwind utilities `bg-paper bg-surface-2 bg-surface-3 text-ink-2 text-ink-4 border-line-2 border-line-strong bg-brand-weak bg-brand-weak-2 text-brand-ink bg-attention text-attention-strong bg-attention-weak bg-danger-weak text-danger-strong`; radii `rounded-{xs,sm,md,lg,xl,pill}`; shadows `shadow-{sh-1,sh-2,sh-pop}`; fonts `font-display font-ui font-mono`.

- [ ] **Step 1: Add scoped token blocks to `globals.css`**

Append (do not edit `:root`/`.dark`):

```css
@layer base {
  /* ---- StewardAI app palette (paper) — scoped so landing is untouched ---- */
  .steward-app {
    --background: 42 31% 94%;      /* paper  #f4f1ea */
    --foreground: 50 12% 9%;       /* ink    #1b1a15 */
    --card: 43 100% 99%;           /* surface #fffdf8 */
    --card-foreground: 50 12% 9%;
    --popover: 43 100% 99%;
    --popover-foreground: 50 12% 9%;
    --primary: 162 42% 30%;        /* brand  #2c6b58 */
    --primary-foreground: 135 33% 98%;
    --secondary: 42 25% 90%;       /* surface-2 #ece8df */
    --secondary-foreground: 50 12% 9%;
    --muted: 42 25% 90%;
    --muted-foreground: 46 8% 50%; /* ink-3 #8b8676 */
    --accent: 162 42% 30%;
    --accent-foreground: 135 33% 98%;
    --destructive: 9 61% 40%;      /* danger #a63a28 */
    --destructive-foreground: 20 100% 98%;
    --border: 42 24% 86%;          /* line #e4dfd3 */
    --input: 42 24% 86%;
    --ring: 162 42% 30%;
    --radius: 9px;

    /* extended (raw colors) */
    --paper: #f4f1ea; --surface: #fffdf8; --surface-2: #ece8df; --surface-3: #e3ded3;
    --ink: #1b1a15; --ink-2: #57534a; --ink-3: #8b8676; --ink-4: #a8a394;
    --line: #e4dfd3; --line-2: #d5cfc0; --line-strong: #c4bdaa;
    --brand: #2c6b58; --brand-2: #225345; --brand-ink: #1e4a3d;
    --brand-weak: #e3ede7; --brand-weak-2: #d3e3da; --on-brand: #f7fbf8;
    --attention: #9a6712; --attention-strong: #7d5209; --attention-weak: #f8eed6; --on-attention: #3a2704;
    --danger: #a63a28; --danger-strong: #87301f; --danger-weak: #f6e2dc; --on-danger: #fff6f3;
    --sh-1: 0 1px 2px rgba(28,26,22,.06), 0 1px 1px rgba(28,26,22,.04);
    --sh-2: 0 6px 20px -6px rgba(28,26,22,.14), 0 2px 6px -2px rgba(28,26,22,.08);
    --sh-pop: 0 18px 44px -14px rgba(28,26,22,.28), 0 4px 12px -4px rgba(28,26,22,.14);
    --scrim: rgba(28,26,22,.32);
  }
  .dark .steward-app {
    --background: 60 9% 7%; --foreground: 45 33% 93%;
    --card: 50 12% 10%; --card-foreground: 45 33% 93%;
    --popover: 50 12% 10%; --popover-foreground: 45 33% 93%;
    --primary: 161 41% 53%; --primary-foreground: 160 38% 8%;
    --secondary: 49 18% 12%; --secondary-foreground: 45 33% 93%;
    --muted: 49 18% 12%; --muted-foreground: 45 8% 48%;
    --accent: 161 41% 53%; --accent-foreground: 160 38% 8%;
    --destructive: 12 72% 68%; --destructive-foreground: 20 60% 6%;
    --border: 49 14% 15%; --input: 49 14% 15%; --ring: 161 41% 53%;

    --paper: #131310; --surface: #1c1b16; --surface-2: #242219; --surface-3: #2d2a20;
    --ink: #f3f0e7; --ink-2: #b7b2a3; --ink-3: #847f70; --ink-4: #645f53;
    --line: #2c2a21; --line-2: #38352a; --line-strong: #494538;
    --brand: #57b899; --brand-2: #69c6a8; --brand-ink: #8ad7bd;
    --brand-weak: #182a24; --brand-weak-2: #20382f; --on-brand: #0c1b16;
    --attention: #e2ab54; --attention-strong: #f0bd6c; --attention-weak: #2b2213; --on-attention: #1a1305;
    --danger: #e88a72; --danger-strong: #f0a58f; --danger-weak: #2c1a15; --on-danger: #1c0f0b;
    --sh-1: 0 1px 2px rgba(0,0,0,.4);
    --sh-2: 0 8px 24px -6px rgba(0,0,0,.55), 0 2px 6px -2px rgba(0,0,0,.4);
    --sh-pop: 0 22px 52px -14px rgba(0,0,0,.7), 0 6px 16px -6px rgba(0,0,0,.5);
    --scrim: rgba(0,0,0,.55);
  }
  .steward-app { font-family: var(--font-ui), system-ui, sans-serif; }
  .steward-app :is(h1,h2,h3,.font-display) { font-family: var(--font-display), var(--font-ui), sans-serif; }
}
```

Also append the design keyframes (reduced-motion aware) under `@layer utilities`:

```css
@layer utilities {
  @keyframes sc-pulse {0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes sc-ring {0%{transform:scale(.8);opacity:.7}100%{transform:scale(2.4);opacity:0}}
  @keyframes sc-fadeup {from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes sc-toastin {from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
  @keyframes sc-checkpop {0%{transform:scale(.4);opacity:0}60%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}
  @keyframes sc-shimmer {100%{background-position:-200% 0}}
  .anim-pulse{animation:sc-pulse 1s infinite}
  .anim-ring{animation:sc-ring 1.6s ease-out infinite}
  .anim-fadeup{animation:sc-fadeup .16s ease}
  .anim-toastin{animation:sc-toastin .22s cubic-bezier(.2,.9,.3,1)}
  .anim-checkpop{animation:sc-checkpop .4s ease}
  @media (prefers-reduced-motion: reduce){
    .anim-pulse,.anim-ring,.anim-fadeup,.anim-toastin,.anim-checkpop{animation:none}
  }
}
```

- [ ] **Step 2: Extend `tailwind.config.ts`**

Add to `theme.extend`:

```ts
fontFamily: {
  sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
  mono: ["var(--font-mono-plex)", "var(--font-mono)", "ui-monospace", "monospace"],
  display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
  ui: ["var(--font-ui)", "ui-sans-serif", "sans-serif"],
},
colors: {
  /* keep existing shadcn color mappings, then add: */
  paper: "var(--paper)",
  surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)", 3: "var(--surface-3)" },
  ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)", 4: "var(--ink-4)" },
  line: { DEFAULT: "var(--line)", 2: "var(--line-2)", strong: "var(--line-strong)" },
  brand: { DEFAULT: "var(--brand)", 2: "var(--brand-2)", ink: "var(--brand-ink)",
           weak: "var(--brand-weak)", "weak-2": "var(--brand-weak-2)", on: "var(--on-brand)" },
  attention: { DEFAULT: "var(--attention)", strong: "var(--attention-strong)",
               weak: "var(--attention-weak)", on: "var(--on-attention)" },
  danger: { DEFAULT: "var(--danger)", strong: "var(--danger-strong)",
            weak: "var(--danger-weak)", on: "var(--on-danger)" },
},
borderRadius: {
  xs: "4px", sm: "6px", md: "9px", lg: "13px", xl: "18px", pill: "999px",
},
boxShadow: { "sh-1": "var(--sh-1)", "sh-2": "var(--sh-2)", "sh-pop": "var(--sh-pop)" },
```

> Note: this repurposes `rounded-md/lg/sm` to 9/13/6px. shadcn `ui/*` use these; verify in Task 2. `border-border` still resolves via the scoped `--border`.

- [ ] **Step 3: Font fetch script + wiring**

Create `portal/scripts/fetch-design-fonts.sh` (downloads OFL woff2 into `src/app/fonts/`; if offline, the step is skipped and fonts fall back). Then modify `portal/src/app/app/layout.tsx`:

```tsx
import localFont from "next/font/local";
const display = localFont({ src: "../fonts/BricolageGrotesk.woff2", variable: "--font-display", display: "swap", weight: "400 800" });
const ui = localFont({ src: "../fonts/HankenGrotesk.woff2", variable: "--font-ui", display: "swap", weight: "400 800" });
const plex = localFont({ src: "../fonts/IBMPlexMono.woff2", variable: "--font-mono-plex", display: "swap", weight: "400 600" });
```

Wrap the layout's returned tree root element (the element currently wrapping `<Sidebar>` + `<main>`) with:

```tsx
<div className={`steward-app ${display.variable} ${ui.variable} ${plex.variable} min-h-screen bg-background text-foreground`} data-theme={theme}>
  {/* existing ThemeProvider + Sidebar + main */}
</div>
```

If a font file is absent, `next/font/local` build fails — so guard: only reference files that exist; otherwise omit that `localFont` and let `--font-ui` fall back to `--font-sans` (document in a code comment).

- [ ] **Step 4: Verify — build + landing regression**

Run:
```bash
cd portal && npx tsc --noEmit && npm run lint && npm run build
```
Expected: build succeeds. Then run the app (`npm run dev`) and confirm:
- `/app` shell background is warm paper (not white), primary is green.
- `/` (landing) is visually unchanged (teal/white, hero animations intact).

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/globals.css portal/tailwind.config.ts portal/src/app/app/layout.tsx portal/scripts/fetch-design-fonts.sh portal/src/app/fonts
git commit -m "feat(portal): paper design tokens + fonts scoped to app shell"
```

---

### Task 2: Restyle shadcn `ui/*` primitives + shared common components

**Files:**
- Modify: `portal/src/components/ui/{button,card,dialog,dropdown-menu,input,switch,tabs,badge,checkbox,skeleton,avatar,separator}.tsx` (variant/class tweaks only)
- Create: `portal/src/components/common/{StatusPill,SpaceChip,PlatformChip,SectionCard,EmptyState,ErrorState,ConfidenceBadge}.tsx`
- Test: `portal/src/components/common/__tests__/StatusPill.test.tsx`

**Interfaces:**
- Produces: `<StatusPill status="in_meeting|done|failed|scheduled|pending"/>`, `<SpaceChip name/>`, `<PlatformChip platform="Google Meet|Zoom|Teams"/>`, `<SectionCard label actions>…</SectionCard>`, `<EmptyState icon title body action/>`, `<ErrorState title body onRetry/>`, `<ConfidenceBadge level="high|medium|low"/>`.

- [ ] **Step 1: Restyle primitives to design.** For each `ui/*` file, update the `cva` variants so defaults match the design (button primary = `bg-primary text-primary-foreground rounded-md shadow-sh-1 hover:bg-brand-2`; ghost = `border border-line-2 bg-transparent`; card = `rounded-lg border border-line bg-card shadow-sh-1`; dialog content = `rounded-xl border-line-2 shadow-sh-pop`; switch checked = `bg-primary`; tabs = segmented pill on `bg-surface-2`). Reference design button styles at lines ~197, 335–336, 900–902; card usage throughout. Keep all prop APIs unchanged.

- [ ] **Step 2: Write failing test for StatusPill**

```tsx
import { render } from "@testing-library/react";
import { StatusPill } from "../StatusPill";
test("in_meeting shows Live with brand tone", () => {
  const { getByText } = render(<div className="steward-app"><StatusPill status="in_meeting" /></div>);
  expect(getByText(/live/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run — expect fail** `cd portal && npx jest StatusPill` → FAIL (module not found).

- [ ] **Step 4: Implement common components.** Create each per the design's pill/chip/empty/error markup (status pill dots + labels: in_meeting→"Live" brand, done→"Completed" ink-3, failed→"Failed" danger, scheduled→"Scheduled" ink-4). EmptyState/ErrorState mirror the repeated design blocks (icon tile + title + body + button), e.g. design lines 222–223 (empty), 219–221 (error).

- [ ] **Step 5: Run — expect pass** `cd portal && npx jest StatusPill` → PASS.

- [ ] **Step 6: Verify + commit** `npx tsc --noEmit && npm run lint`; then:
```bash
git add portal/src/components/ui portal/src/components/common
git commit -m "feat(portal): restyle ui primitives + add common design components"
```

---

### Task 3: App shell — sidebar, topbar, mobile nav/drawer, account menu

**Files:**
- Modify: `portal/src/components/app-shell/Sidebar.tsx`, `ThemeToggle.tsx`, `UserMenu.tsx`, `PageHeader.tsx`
- Create: `portal/src/components/app-shell/Topbar.tsx`, `MobileBottomNav.tsx`
- Modify: `portal/src/app/app/layout.tsx` (compose Topbar + bottom nav)

**Interfaces:**
- Consumes: `.steward-app` scope + tokens (Task 1), common components (Task 2).
- Produces: `<Topbar title subtitle/>` slot API; nav item list constant `NAV` updated (Home→`/app`, Meetings→`/app/meetings`).

- [ ] **Step 1: Sidebar** — rebuild to design lines 121–174: brand block, **Ask Steward** primary button (→`/app/chat`), grouped nav (Workspace: Home `/app`, Meetings `/app/meetings` + live dot, Action items + open badge, Spaces + review badge; Account: Connected apps, Usage, Settings), footer account button → account menu (Settings / Usage & billing / theme switch / Sign out). Badges: pass counts as props from layout (open action items, review count).
- [ ] **Step 2: Topbar** — new component, design lines 181–209: title/subtitle, desktop ⌘K search trigger (opens palette from Task 4), Instant-join button (opens dialog from Task 4), Nudges bell + count, theme toggle. Per-route title/subtitle map.
- [ ] **Step 3: Mobile** — hamburger→drawer (design 1441–1464) and bottom nav (design 1430–1436: Home/Ask/Meetings/Actions/Spaces). Restyle existing drawer.
- [ ] **Step 4: Wire counts** — in `layout.tsx`, fetch open-action-items count and review (unfiled) count server-side (reuse queries from `spaces/page.tsx` and `actions/page.tsx`) and pass to Sidebar/Topbar.
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npm run lint`; drive `/app` desktop + mobile, both themes; nav active states correct.
- [ ] **Step 6: Commit** `git commit -am "feat(portal): redesign app shell (sidebar, topbar, mobile nav)"`

---

### Task 4: Shell overlays — command palette (+ /api/search), nudges (+ derivation), instant-join, new-space, toast

**Files:**
- Create: `portal/src/app/api/search/route.ts`, `portal/src/app/api/nudges/route.ts`
- Create: `portal/src/components/app-shell/{CommandPalette,NudgesPanel,InstantJoinDialog,Toast}.tsx`
- Modify: `portal/src/components/spaces/NewSpaceDialog.tsx` (restyle), `portal/src/components/meetings/InstantJoin.tsx` (extract dialog)
- Create: `portal/src/lib/nudges.ts`
- Test: `portal/src/lib/__tests__/nudges.test.ts`

**Interfaces:**
- Produces: `GET /api/search?q=` → `{ results: {type:"meeting"|"person"|"space"|"action", id, title, sub, href}[] }`; `GET /api/nudges` → `{ nudges: Nudge[] }`; `deriveNudges(input): Nudge[]`.

- [ ] **Step 1: Write failing test for nudges derivation**

```ts
import { deriveNudges } from "../nudges";
test("overdue action item becomes a nudge", () => {
  const n = deriveNudges({ overdueActions: [{ id:"1", task:"Send deck", meetingTitle:"Acme", due:"2026-07-10" }], unfiledCount: 0, failedMeetings: [] });
  expect(n.some(x => x.kind === "overdue_action")).toBe(true);
});
```

- [ ] **Step 2: Run — expect fail** `cd portal && npx jest nudges` → FAIL.
- [ ] **Step 3: Implement `deriveNudges`** — pure function turning {overdueActions, unfiledCount, failedMeetings} into `Nudge{ kind, title, body, act, href }[]` (overdue action, meetings-need-filing, bot-failed). No proactive engine.
- [ ] **Step 4: Run — expect pass** `npx jest nudges` → PASS.
- [ ] **Step 5: Implement `/api/nudges`** (server: gather the three inputs via service client scoped to user, call `deriveNudges`) and `/api/search` (`ilike` over `meetings.title`, `entities.name`, `spaces.name`, `action_items.task`, RLS-scoped, limit 8 each, merged/sorted). Guard both with `requireUserRoute()`.
- [ ] **Step 6: Build overlays** — CommandPalette (design 1865–1890, debounced fetch to `/api/search`, ↵/esc, result rows by type badge), NudgesPanel (design 1904–1922, fetch `/api/nudges`, act/dismiss — dismiss is client-local), InstantJoinDialog (design 1892–1902; keep Meet-only note), restyle NewSpaceDialog (design 1924–1934) and Toast host (design 1936+). Wire triggers from Topbar (Task 3).
- [ ] **Step 7: Verify** — ⌘K opens palette and returns results; bell opens nudges; instant-join posts and navigates. `npx tsc --noEmit && npm run lint`.
- [ ] **Step 8: Commit** `git commit -am "feat(portal): command palette, nudges, instant-join, new-space, toast overlays"`

---

### Task 5: Home dashboard (`/app`) — new page

**Files:**
- Create: `portal/src/lib/home.ts` (data assembly), `portal/src/components/home/{Greeting,AskBar,TodaysAgenda,RecentRecaps,NeedsAction,SpacesPulse}.tsx`
- Modify: `portal/src/app/app/page.tsx` (replace meetings-home with dashboard)
- Test: `portal/src/lib/__tests__/home.test.ts`

**Interfaces:**
- Consumes: existing `meetings`, `summaries`, `action_items`, `spaces`, `space_facts` queries.
- Produces: `buildHomeData(rows): { meetingsToday, openActions, agenda, recaps, needsAction, reviewCount, spacesPulse }`.

- [ ] **Step 1: Failing test** for `buildHomeData` (given meetings with today/other start_times, returns only today's in `agenda`; counts open actions).
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement `buildHomeData`** (pure; date filtering uses a passed `now` for testability).
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Build page + components** to design lines 226–304 (greeting, ask bar w/ suggestion chips → `/app/chat`, Today's agenda, Recent recaps, Needs-action, Review-queue banner → `/app/spaces/unfiled`, Spaces pulse). Loading/empty/error states per design 216–224. Keep the calendar-not-connected gate (existing logic) as the empty state.
- [ ] **Step 6: Verify** — `/app` renders dashboard w/ real data, both themes. `npx tsc --noEmit && npm run lint`.
- [ ] **Step 7: Commit** `git commit -am "feat(portal): new Home dashboard at /app"`

---

### Task 6: Meetings list (`/app/meetings`) — new page

**Files:**
- Create: `portal/src/app/app/meetings/page.tsx`
- Create: `portal/src/components/meetings/{MeetingsHeader,LiveNowCard,UpcomingGroups,PastList}.tsx`
- Reuse: `lib/meetings/series.ts` (`buildHomeSections`), existing `OptInToggle`, `InstantJoin` gate.

- [ ] **Step 1: Build page** to design lines 359–464: header (date, "1 live now", counts), Upcoming/Past tabs (URL `?tab=`), "Happening now" card when any meeting `bot_status='in_meeting'` (→ its live detail), grouped upcoming rows (opt-in Switch, PlatformChip, avatars, SpaceChip, StatusPill) via `buildHomeSections`, Past list (summary line, action count, StatusPill). States 311–357 (loading/error/empty w/ Connect-calendar + trust pills).
- [ ] **Step 2: Point sidebar "Meetings" at `/app/meetings`** (already set in Task 3; verify).
- [ ] **Step 3: Verify** — upcoming/past tabs work; opt-in toggles persist; live card appears for in-meeting. `npx tsc --noEmit && npm run lint`.
- [ ] **Step 4: Commit** `git commit -am "feat(portal): Meetings list page at /app/meetings"`

---

### Task 7: Meeting detail — restyle

**Files:**
- Modify: `portal/src/app/app/meetings/[id]/page.tsx` and `portal/src/components/meetings/{MeetingHeader,MeetingSpaceSection,MeetingSummary,MeetingTimeline,AgentActionsPanel,ActionItemsPanel,MeetingExportActions,ActionStepCard}.tsx`

- [ ] **Step 1: Restyle** to design lines 468–740: header (title, StatusPill, mono meta, Completed/Live toggle), meta chips (attendee avatars, changeable space picker menu, tags), two-column transcript (search, named speakers incl. Steward "spoke in room", live-poll unchanged) + recap rail (Summary, Decisions, Open questions/risks, Action items, **What Steward did**=`agent_actions` approve/dismiss/edit). Mobile Transcript/Recap tab switch (592–597). Keep all existing data wiring, approval POSTs, export, live polling — only markup/classes change.
- [ ] **Step 2: States** — bot-failed error (design ~471–507), scheduled-empty (509–531), loading skeleton.
- [ ] **Step 3: Verify** — open a done meeting + a live meeting; approve/dismiss an agent action; transcript search highlights; export copies. `npx tsc --noEmit && npm run lint`.
- [ ] **Step 4: Commit** `git commit -am "feat(portal): restyle meeting detail"`

---

### Task 8: Chat — restyle + scope selector

**Files:**
- Modify: `portal/src/app/app/chat/page.tsx`, `portal/src/components/chat/{ChatSidebar,ChatMessages,Composer,PermissionCard,ConnectCard,Citation}.tsx`, `portal/src/hooks/useChat.ts` (scope prefix only)

- [ ] **Step 1: Restyle** to design lines 742–992: thread rail w/ scope+time chips, empty state w/ suggestion cards, thinking/tool trace, answer + bullets + citation chips, PermissionCard (approve-with-preview email), ConnectCard, reversible-action receipt (**Undo omitted** per spec).
- [ ] **Step 2: Scope selector** — add composer scope dropdown (All work / a Space / a Meeting), design 959–970. On send, prepend a scope hint to the message text in `useChat.send` (e.g. `"[Scope: space \"Acme\"] "`); no WS protocol change. Populate space/meeting options from a light fetch (reuse `/api/search` or a spaces list).
- [ ] **Step 3: Verify** — send a message, approve an email draft, connect-app card flow, citations link to meetings, scope prefix appears in sent payload. `npx tsc --noEmit && npm run lint`.
- [ ] **Step 4: Commit** `git commit -am "feat(portal): restyle chat + scope selector"`

---

### Task 9: Spaces overview + Space detail + Review queue — restyle

**Files:**
- Modify: `portal/src/app/app/spaces/page.tsx`, `spaces/[id]/page.tsx`, `spaces/unfiled/page.tsx`, and `portal/src/components/spaces/{SpaceCard,SpaceFactsPanel,SpaceEntities,FileMeetingControl,MeetingRow,SeriesCard}.tsx`

- [ ] **Step 1: Overview** — design 995–1056: header + New space, review backstop banner, grid of group cards (nested children) + leaf cards (avatars, open-count, updated). Uses `buildSpaceTree`.
- [ ] **Step 2: Detail** — design 1059–1139: breadcrumb, header + "Ask about this space" (→ chat with meeting/space scope), **State-of-thread brief hidden** (spec §7), What's-known fact groups w/ citations, Meetings filed here, right rail Companies + People.
- [ ] **Step 3: Review queue** — design 1142–1195: per-meeting card, ConfidenceBadge (`space_confidence` → high/medium/low), Confirm/Pick-another/File-to-new-space via existing `FileMeetingControl`.
- [ ] **Step 4: Verify** — tree renders, file a meeting from the queue, facts link to source meetings. `npx tsc --noEmit && npm run lint`.
- [ ] **Step 5: Commit** `git commit -am "feat(portal): restyle spaces, space detail, review queue"`

---

### Task 10: Action items — restyle (buckets + stat strip)

**Files:**
- Modify: `portal/src/app/app/actions/page.tsx`, `portal/src/components/meetings/ActionItemsList.tsx`, `portal/src/lib/meetings/actions.ts`
- Test: `portal/src/lib/meetings/__tests__/actions.test.ts`

- [ ] **Step 1: Failing test** — extend `actions.ts` with `bucketActions(rows, now)` → `{ open:{overdue,today,upcoming,noDate}, done, stats:{open,overdue,today,done} }`; test overdue/today classification.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement `bucketActions`** (pure).
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Restyle page** to design 1209–1264: stat strip (Open/Overdue/Due today/Completed), Open/Completed/All tabs, buckets, owner avatars + due pills, checkbox toggles (existing `done` write).
- [ ] **Step 6: Verify + commit** `npx tsc --noEmit && npm run lint`; `git commit -am "feat(portal): restyle action items with buckets + stats"`

---

### Task 11: Connected apps — restyle

**Files:** Modify `portal/src/app/app/settings/connections/page.tsx`, `portal/src/components/integrations/AppCard.tsx`

- [ ] **Step 1: Restyle** to design 1269–1320: search + category pills, Connected / Available / Coming-soon sections, AppCard (tile, status pill, account label, connect/disconnect). Keep existing catalog + Composio routes + OAuth popup return.
- [ ] **Step 2: Verify** — connect/disconnect works; coming-soon apps show "notify". `npx tsc --noEmit && npm run lint`.
- [ ] **Step 3: Commit** `git commit -am "feat(portal): restyle connected apps"`

---

### Task 12: Usage — restyle (aggregation + bar chart)

**Files:** Modify `portal/src/app/app/usage/page.tsx`; Create `portal/src/lib/usage.ts`; Test `portal/src/lib/__tests__/usage.test.ts`

- [ ] **Step 1: Failing test** — `aggregateUsage(logs, range)` → `{ stats:[4 tiles], perWeekBars:[{d,chatH,askH,sumH}], byFeature:[{label,calls,cost,tone}], total }`; test per-week bucketing + cost sum.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement `aggregateUsage`** (pure; consumes existing `usage_logs` rows).
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Restyle page** to design 1334–1370: range toggle (7/30/90d → widen query window), stat tiles, stacked "meetings processed per week" bars, per-feature cost table + total. Keep owner-only access control.
- [ ] **Step 6: Verify + commit** `npx tsc --noEmit && npm run lint`; `git commit -am "feat(portal): restyle usage with chart + aggregation"`

---

### Task 13: Settings — restyle

**Files:** Modify `portal/src/app/app/settings/page.tsx`

- [ ] **Step 1: Restyle** to design 1382–1422: Calendar connection (reconnect), Assistant name / wake word (single `bot_name` field, design copy), Plan card (**Manage plan disabled / "coming soon"** per spec §7), Appearance light/dark picker (→ theme), Account + Sign out. Keep existing `profiles` writes + calendar link.
- [ ] **Step 2: Verify** — save bot name, toggle theme picker, reconnect link. `npx tsc --noEmit && npm run lint`.
- [ ] **Step 3: Commit** `git commit -am "feat(portal): restyle settings"`

---

### Task 14: Auth / onboarding — restyle

**Files:** Modify the sign-in/onboarding UI (`portal/src/app/auth/*` and/or the sign-in entry). Confirm exact files at execution (grep for the Google sign-in button).

- [ ] **Step 1: Locate** the current sign-in/onboarding components (`grep -rn "Continue with Google\|auth/login" portal/src`).
- [ ] **Step 2: Restyle** to design 1780–1862: split brand pane + form; steps Sign in (Google) → Connect calendar → Done. Wrap in `.steward-app` scope so tokens apply. Back existing Google OAuth + calendar connect.
- [ ] **Step 3: Verify** — sign-in renders in paper palette; OAuth still works. `npx tsc --noEmit && npm run lint`.
- [ ] **Step 4: Commit** `git commit -am "feat(portal): restyle auth/onboarding"`

---

### Task 15: Final verification — regression, themes, responsive, suite

**Files:** none (verification + fixes only)

- [ ] **Step 1: Landing regression** — open `/`, `/privacy`, `/terms`, `/cookies`, `/trust`; confirm pixel-identical to `main` (palette, Inter font, hero waveform/`accent-text`/`bg-grid`). If any regressed, the scope boundary leaked — fix by tightening `.steward-app`.
- [ ] **Step 2: Theme + responsive sweep** — every `/app/*` screen in light + dark, desktop + mobile; check loading/empty/error/populated where available.
- [ ] **Step 3: Full suite** — `cd portal && npm run lint && npx tsc --noEmit && npm run build && npm run test`. All pass.
- [ ] **Step 4: Stub audit** — confirm billing "Manage plan" disabled, Zoom/Teams note present, email-undo absent, space-brief hidden; ⌘K/nudges/chat-scope functional.
- [ ] **Step 5: Commit** any fixes `git commit -am "test(portal): redesign verification fixes"`

---

## Self-Review

**Spec coverage:** Foundation §2 → Task 1; primitives/common §6 → Task 2; shell §3 → Task 3; overlays + new backend §3/§8 → Task 4; routing + Home §4/§5.1 → Task 5; Meetings §5.2 → Task 6; Meeting detail §5.3 → Task 7; Chat + scope §5.4/§8 → Task 8; Spaces trio §5.5–7 → Task 9; Actions §5.8 → Task 10; Connections §5.9 → Task 11; Usage §5.10 → Task 12; Settings §5.11 → Task 13; Auth §5.12 → Task 14; stubs §7 → applied in Tasks 7/8/9/11/13 + audited Task 15; landing non-goal §1 → Tasks 1 & 15. All spec sections covered.

**Placeholder scan:** logic tasks (1,2,4,5,10,12) carry real code/tests; restyle tasks reference exact design line ranges + existing files + token mappings rather than fabricated JSX (honest for a reskin). No "TBD"/"handle edge cases".

**Type consistency:** `buildHomeData`, `deriveNudges`, `bucketActions`, `aggregateUsage`, `Nudge`, and the `/api/search` result shape are each defined once and consumed by their page; nav route strings (`/app`, `/app/meetings`) consistent across Tasks 3/5/6.
