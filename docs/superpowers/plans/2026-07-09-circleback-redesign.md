# Circleback-style Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the StewardAI product surfaces (`portal/`) to Circleback's clean, meeting-centric UX — light/dark themable, restyled meetings list & detail, searchable transcript, a global Action Items page, copy/export — and remove the now-redundant Ask page.

**Architecture:** Next.js 14 App Router app under `portal/src/app/app/*`, Tailwind (HSL CSS-variable tokens, `darkMode: ["class"]`), shadcn-style UI primitives, Supabase (RLS-scoped `createServerClient` for reads, `createBrowserClient` for client mutations). We preserve all existing token names so the theme flip is palette-only; new screens reuse existing components and data fetches.

**Tech Stack:** TypeScript, React 18, Next 14.2, TailwindCSS, Supabase JS, lucide-react icons, Jest + ts-jest.

## Global Constraints

- Package manager: `npm` (run all commands from `portal/`).
- No new npm dependencies — theme toggle is hand-rolled (no `next-themes`).
- Preserve existing Tailwind token names (`--background`, `--foreground`, `--card`, `--primary`, `--border`, `--muted`, etc.); only values change between light/dark.
- Product surfaces default to **light**; the marketing landing page (`src/app/page.tsx` and `src/components/landing/*`) must remain visually unchanged (it currently assumes the dark palette — scope its wrapper to `.dark`, see Task 2).
- Tests: `npm test` (Jest). Lint/build: `npm run lint`, `npm run build`.
- Commit after each task with the message shown in its final step.

---

## File Structure

**Deleted**
- `src/app/app/ask/page.tsx`, `src/components/ask/AskPanel.tsx`, `src/lib/ask/client.ts`, `src/lib/ask/client.test.ts`

**Created**
- `src/components/app-shell/ThemeProvider.tsx` — client theme context + `<html>` class sync
- `src/components/app-shell/ThemeToggle.tsx` — light/dark button (sidebar footer)
- `src/lib/theme.ts` — theme cookie constants + parse helper (pure, testable)
- `src/lib/theme.test.ts`
- `src/lib/meetings/export.ts` — `meetingToMarkdown(...)` pure fn
- `src/lib/meetings/export.test.ts`
- `src/lib/meetings/actions.ts` — `groupActionItems(...)` pure fn (open/done split + due sort)
- `src/lib/meetings/actions.test.ts`
- `src/components/meetings/MeetingExportActions.tsx` — Copy / Download .md buttons (client)
- `src/components/meetings/ActionItemsList.tsx` — client list w/ toggle, used by global page
- `src/app/app/actions/page.tsx` — global Action Items page (server component)

**Modified**
- `src/app/globals.css` — add light `:root` palette, move dark under `.dark`
- `src/app/app/layout.tsx` — read theme cookie, wrap in ThemeProvider, set initial class
- `src/app/page.tsx` (landing) — wrap landing in a `.dark` container so it keeps its dark look
- `src/components/app-shell/Sidebar.tsx` — remove Ask nav, add Action Items nav, mount ThemeToggle
- `src/components/meetings/MeetingRow.tsx` — Circleback row restyle (date col, avatars, tldr)
- `src/components/meetings/MeetingHeader.tsx` — mount `MeetingExportActions`
- `src/components/meetings/MeetingTimeline.tsx` — in-transcript search box + highlight
- `src/components/meetings/ActionItemsPanel.tsx` — extract shared toggle + assignee chip styling
- `src/app/app/meetings/[id]/page.tsx` — pass export data into header

---

## Task 1: Remove the Ask feature

**Files:**
- Delete: `src/app/app/ask/page.tsx`, `src/components/ask/AskPanel.tsx`, `src/lib/ask/client.ts`, `src/lib/ask/client.test.ts`
- Modify: `src/components/app-shell/Sidebar.tsx:17-25` (NAV array)

**Interfaces:**
- Consumes: nothing.
- Produces: nav no longer references `/app/ask`. (Action Items nav entry added in Task 4.)

- [ ] **Step 1: Confirm no remaining importers**

Run: `cd portal && grep -rn "lib/ask\|AskPanel\|/app/ask" src --include='*.ts' --include='*.tsx' | grep -v "src/lib/ask/\|src/components/ask/\|src/app/app/ask/"`
Expected: no output (only the files being deleted reference it).

- [ ] **Step 2: Delete the files**

```bash
cd portal
rm src/app/app/ask/page.tsx src/components/ask/AskPanel.tsx src/lib/ask/client.ts src/lib/ask/client.test.ts
rmdir src/components/ask src/lib/ask 2>/dev/null || true
```

- [ ] **Step 3: Remove the Ask nav entry**

In `src/components/app-shell/Sidebar.tsx`, delete this line from the `NAV` array (line ~20):

```tsx
  { href: "/app/ask", label: "Ask", icon: MessageCircle, isActive: (p) => p.startsWith("/app/ask") },
```

Also remove `MessageCircle` from the lucide import on line 6 (it is now unused).

- [ ] **Step 4: Verify build & tests are clean**

Run: `cd portal && npm run lint && npm test`
Expected: PASS, no references to deleted modules, no unused-import lint error.

- [ ] **Step 5: Commit**

```bash
cd portal && git add -A && git commit -m "feat(portal): remove Ask page — Chat is the single conversational surface"
```

---

## Task 2: Light/dark theme tokens + provider

**Files:**
- Create: `src/lib/theme.ts`, `src/lib/theme.test.ts`
- Create: `src/components/app-shell/ThemeProvider.tsx`
- Modify: `src/app/globals.css:5-30`
- Modify: `src/app/page.tsx` (landing — wrap in `.dark`)

**Interfaces:**
- Produces:
  - `THEME_COOKIE = "theme"`, `type Theme = "light" | "dark"`, `parseTheme(value: string | undefined): Theme` (defaults to `"light"`).
  - `ThemeProvider({ initial, children }: { initial: Theme; children: React.ReactNode })` — React context provider; exposes `useTheme(): { theme: Theme; toggle: () => void }`.

- [ ] **Step 1: Write the failing test for `parseTheme`**

Create `src/lib/theme.test.ts`:

```ts
import { parseTheme, THEME_COOKIE } from "./theme";

describe("parseTheme", () => {
  it("defaults to light when undefined", () => {
    expect(parseTheme(undefined)).toBe("light");
  });
  it("returns dark when cookie is dark", () => {
    expect(parseTheme("dark")).toBe("dark");
  });
  it("falls back to light on garbage", () => {
    expect(parseTheme("purple")).toBe("light");
  });
  it("exposes the cookie name", () => {
    expect(THEME_COOKIE).toBe("theme");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd portal && npm test -- theme.test`
Expected: FAIL — cannot find module `./theme`.

- [ ] **Step 3: Implement `src/lib/theme.ts`**

```ts
export const THEME_COOKIE = "theme";
export type Theme = "light" | "dark";

export function parseTheme(value: string | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `cd portal && npm test -- theme.test`
Expected: PASS.

- [ ] **Step 5: Add the light palette and scope dark under `.dark`**

In `src/app/globals.css`, replace the `:root { ... }` block (lines ~6-29) with a light `:root` plus a `.dark` override. Keep every token name:

```css
  :root {
    /* Light — Circleback-style: white ground, near-black text, gray hairlines,
       teal accent retained. */
    --background: 0 0% 100%;
    --foreground: 220 26% 12%;
    --card: 0 0% 100%;
    --card-foreground: 220 26% 12%;
    --popover: 0 0% 100%;
    --popover-foreground: 220 26% 12%;
    --primary: 172 74% 38%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 16% 96%;
    --secondary-foreground: 220 26% 12%;
    --muted: 220 16% 96%;
    --muted-foreground: 220 10% 42%;
    --accent: 172 74% 38%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 72% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 16% 90%;
    --input: 220 16% 90%;
    --ring: 172 74% 38%;
    --radius: 0.75rem;
  }

  .dark {
    /* Original dark-premium palette. */
    --background: 220 26% 5%;
    --foreground: 210 22% 96%;
    --card: 220 24% 8%;
    --card-foreground: 210 22% 96%;
    --popover: 220 26% 6%;
    --popover-foreground: 210 22% 96%;
    --primary: 172 84% 50%;
    --primary-foreground: 220 30% 6%;
    --secondary: 218 20% 14%;
    --secondary-foreground: 210 22% 96%;
    --muted: 218 18% 13%;
    --muted-foreground: 215 16% 60%;
    --accent: 172 84% 50%;
    --accent-foreground: 220 30% 6%;
    --destructive: 0 72% 55%;
    --destructive-foreground: 210 22% 96%;
    --border: 216 20% 16%;
    --input: 216 20% 16%;
    --ring: 172 84% 50%;
    --radius: 0.75rem;
  }
```

- [ ] **Step 6: Keep the landing page dark**

The landing page was designed against the dark palette. In `src/app/page.tsx`, wrap the returned top-level element in a `dark` container so it renders with the dark tokens regardless of product theme. Open the file, and add `className="dark"` (merged with any existing className) to the outermost wrapper element, e.g.:

```tsx
// before:  return ( <main> ... </main> )
// after:
return (
  <div className="dark bg-background text-foreground">
    {/* existing landing content unchanged */}
    ...
  </div>
);
```

If the file already has a root wrapper, add `dark` to its className instead of introducing a new div.

- [ ] **Step 7: Implement `ThemeProvider`**

Create `src/components/app-shell/ThemeProvider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

type Ctx = { theme: Theme; toggle: () => void };
const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ initial, children }: { initial: Theme; children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
    try { localStorage.setItem(THEME_COOKIE, theme); } catch {}
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

- [ ] **Step 8: Verify lint + tests**

Run: `cd portal && npm run lint && npm test -- theme.test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd portal && git add -A && git commit -m "feat(portal): light/dark theme tokens + ThemeProvider (product defaults light)"
```

---

## Task 3: Wire theme into the app shell + toggle button

**Files:**
- Modify: `src/app/app/layout.tsx`
- Create: `src/components/app-shell/ThemeToggle.tsx`
- Modify: `src/components/app-shell/Sidebar.tsx` (mount toggle in both desktop + mobile footers)

**Interfaces:**
- Consumes: `ThemeProvider`, `useTheme`, `parseTheme`, `THEME_COOKIE` from Task 2.
- Produces: `<ThemeToggle />` rendered in the sidebar footer; `<html class="dark">` set on the server when the cookie is `dark`.

- [ ] **Step 1: Read the theme cookie in the app layout and apply the class server-side**

Replace `src/app/app/layout.tsx` with:

```tsx
import { cookies } from "next/headers";
import { TimezoneSync } from "@/components/TimezoneSync";
import { Sidebar } from "@/components/app-shell/Sidebar";
import { ThemeProvider } from "@/components/app-shell/ThemeProvider";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);

  return (
    <ThemeProvider initial={theme}>
      <div className={`${theme === "dark" ? "dark " : ""}flex h-screen flex-col bg-background lg:flex-row`}>
        <TimezoneSync />
        <Sidebar email={user.email ?? "Account"} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}
```

Note: the `.dark` class is applied to the shell wrapper (not `<html>`) so it never leaks to the landing route; `ThemeProvider`'s effect keeps `document.documentElement` in sync for portal popovers/dialogs that render at the body root.

- [ ] **Step 2: Implement the toggle button**

Create `src/components/app-shell/ThemeToggle.tsx`:

```tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      {isDark ? "Light mode" : "Dark mode"}
    </button>
  );
}
```

- [ ] **Step 3: Mount the toggle in the sidebar footers**

In `src/components/app-shell/Sidebar.tsx`, import it:

```tsx
import { ThemeToggle } from "./ThemeToggle";
```

Then in BOTH footer blocks (desktop `aside` footer ~line 79-81, and mobile drawer footer ~line 116-118), add the toggle above `UserMenu`. Each footer becomes:

```tsx
<div className="space-y-1 border-t border-border p-3">
  <ThemeToggle />
  <UserMenu email={email} />
</div>
```

- [ ] **Step 4: Manually verify the toggle**

Run: `cd portal && npm run dev`, sign in, open `/app`. Click the toggle in the sidebar footer.
Expected: product surfaces flip light↔dark; refresh keeps the choice (cookie); `/` landing stays dark.

- [ ] **Step 5: Verify lint**

Run: `cd portal && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd portal && git add -A && git commit -m "feat(portal): theme toggle in sidebar + SSR theme from cookie"
```

---

## Task 4: Global Action Items page

**Files:**
- Create: `src/lib/meetings/actions.ts`, `src/lib/meetings/actions.test.ts`
- Create: `src/components/meetings/ActionItemsList.tsx`
- Create: `src/app/app/actions/page.tsx`
- Modify: `src/components/app-shell/Sidebar.tsx` (add nav entry)

**Interfaces:**
- Consumes: `createServerClient` (reads), `createBrowserClient` (toggle), `PageHeader`.
- Produces:
  - `type ActionRow = { id: string; owner: string; task: string; due: string | null; done: boolean; meeting_id: string; meeting_title: string }`
  - `groupActionItems(rows: ActionRow[]): { open: ActionRow[]; done: ActionRow[] }` — open first sorted by due (nulls last, ascending), done kept in input order.
  - `ActionItemsList({ rows }: { rows: ActionRow[] })` client component with checkbox toggle + source-meeting link.

- [ ] **Step 1: Write the failing test for `groupActionItems`**

Create `src/lib/meetings/actions.test.ts`:

```ts
import { groupActionItems, type ActionRow } from "./actions";

const row = (over: Partial<ActionRow>): ActionRow => ({
  id: "1", owner: "unassigned", task: "t", due: null, done: false,
  meeting_id: "m1", meeting_title: "Sync", ...over,
});

describe("groupActionItems", () => {
  it("splits open and done", () => {
    const { open, done } = groupActionItems([
      row({ id: "a", done: false }),
      row({ id: "b", done: true }),
    ]);
    expect(open.map((r) => r.id)).toEqual(["a"]);
    expect(done.map((r) => r.id)).toEqual(["b"]);
  });

  it("sorts open by due ascending, nulls last", () => {
    const { open } = groupActionItems([
      row({ id: "a", due: null }),
      row({ id: "b", due: "2026-07-20" }),
      row({ id: "c", due: "2026-07-10" }),
    ]);
    expect(open.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd portal && npm test -- actions.test`
Expected: FAIL — cannot find module `./actions`.

- [ ] **Step 3: Implement `src/lib/meetings/actions.ts`**

```ts
export type ActionRow = {
  id: string;
  owner: string;
  task: string;
  due: string | null;
  done: boolean;
  meeting_id: string;
  meeting_title: string;
};

export function groupActionItems(rows: ActionRow[]): { open: ActionRow[]; done: ActionRow[] } {
  const open = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done);
  open.sort((a, b) => {
    if (a.due === b.due) return 0;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
  });
  return { open, done };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `cd portal && npm test -- actions.test`
Expected: PASS.

- [ ] **Step 5: Implement the client list component**

Create `src/components/meetings/ActionItemsList.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { createBrowserClient } from "@/lib/supabase/client";
import { groupActionItems, type ActionRow } from "@/lib/meetings/actions";

function hasOwner(owner: string): boolean {
  const o = owner?.trim().toLowerCase();
  return !!o && o !== "unassigned";
}

function Item({ r, onToggle }: { r: ActionRow; onToggle: (id: string, done: boolean) => void }) {
  return (
    <li className="flex items-start gap-3 border-b border-border/60 py-3 last:border-0">
      <Checkbox className="mt-0.5" checked={r.done} onCheckedChange={(v) => onToggle(r.id, Boolean(v))} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-relaxed ${r.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
          {hasOwner(r.owner) && <span className="font-medium text-primary">@{r.owner.trim()} — </span>}
          {r.task}
          {r.due ? <span className="text-muted-foreground"> (due {r.due})</span> : null}
        </p>
        <Link href={`/app/meetings/${r.meeting_id}`} className="text-xs text-muted-foreground hover:text-foreground">
          {r.meeting_title}
        </Link>
      </div>
    </li>
  );
}

export function ActionItemsList({ rows }: { rows: ActionRow[] }) {
  const [items, setItems] = useState(rows);

  async function onToggle(id: string, done: boolean) {
    const supabase = createBrowserClient();
    await supabase.from("action_items").update({ done }).eq("id", id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done } : i)));
  }

  const { open, done } = groupActionItems(items);

  if (!items.length) return <p className="text-sm text-muted-foreground">No action items yet.</p>;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open ({open.length})</h2>
        {open.length ? <ul>{open.map((r) => <Item key={r.id} r={r} onToggle={onToggle} />)}</ul>
          : <p className="text-sm text-muted-foreground">Nothing open — nice.</p>}
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Done ({done.length})</h2>
          <ul>{done.map((r) => <Item key={r.id} r={r} onToggle={onToggle} />)}</ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implement the page (server component)**

Create `src/app/app/actions/page.tsx`:

```tsx
import { PageHeader } from "@/components/app-shell/PageHeader";
import { ActionItemsList } from "@/components/meetings/ActionItemsList";
import type { ActionRow } from "@/lib/meetings/actions";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const user = await requireUserPage();
  const db = createServerClient(); // RLS-scoped

  const { data } = await db
    .from("action_items")
    .select("id,owner,task,due,done,meeting_id,meetings(title)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const rows: ActionRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    owner: (r.owner as string) ?? "unassigned",
    task: r.task as string,
    due: (r.due as string | null) ?? null,
    done: Boolean(r.done),
    meeting_id: r.meeting_id as string,
    meeting_title: ((r as unknown as { meetings: { title: string } | null }).meetings?.title) ?? "Meeting",
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Action items" subtitle="Every task Steward captured across your meetings." />
      <ActionItemsList rows={rows} />
    </div>
  );
}
```

Note during implementation: confirm `action_items` has a `user_id` column and a FK to `meetings` (the meeting detail page already reads `action_items` by `meeting_id`; verify `user_id` exists with `grep -rn "user_id" supabase/` or the migration files — if `action_items` has no `user_id`, drop the `.eq("user_id", ...)` filter and rely on RLS via the `meetings` join, filtering client-side is not needed because RLS already scopes reads).

- [ ] **Step 7: Add the nav entry**

In `src/components/app-shell/Sidebar.tsx`, add to the `NAV` array right after the Meetings entry, and add `ListChecks` to the lucide import on line 6:

```tsx
  { href: "/app/actions", label: "Action items", icon: ListChecks, isActive: (p) => p.startsWith("/app/actions") },
```

- [ ] **Step 8: Verify tests, lint, and the page renders**

Run: `cd portal && npm test -- actions.test && npm run lint`
Expected: PASS. Then `npm run dev`, open `/app/actions` — items grouped Open/Done, checkboxes persist on refresh, meeting links navigate.

- [ ] **Step 9: Commit**

```bash
cd portal && git add -A && git commit -m "feat(portal): global Action Items page across all meetings"
```

---

## Task 5: Copy / Export meeting notes (Markdown)

**Files:**
- Create: `src/lib/meetings/export.ts`, `src/lib/meetings/export.test.ts`
- Create: `src/components/meetings/MeetingExportActions.tsx`
- Modify: `src/components/meetings/MeetingHeader.tsx`
- Modify: `src/app/app/meetings/[id]/page.tsx`

**Interfaces:**
- Produces:
  - `type ExportSummary = { tldr: string; decisions: { text: string }[]; discrepancies: { text: string }[] } | null`
  - `type ExportAction = { owner: string; task: string; due: string | null; done: boolean }`
  - `meetingToMarkdown(input: { title: string; startTime: string; summary: ExportSummary; actionItems: ExportAction[] }): string`
  - `MeetingExportActions({ markdown, filename }: { markdown: string; filename: string })` client component.
- Consumes (Task 4-independent): rendered inside `MeetingHeader`, which gains an optional `markdown?: string` prop.

- [ ] **Step 1: Write the failing test**

Create `src/lib/meetings/export.test.ts`:

```ts
import { meetingToMarkdown } from "./export";

describe("meetingToMarkdown", () => {
  it("renders title, summary, decisions, and action items", () => {
    const md = meetingToMarkdown({
      title: "Acme Sync",
      startTime: "2026-07-09T15:00:00.000Z",
      summary: { tldr: "We agreed on scope.", decisions: [{ text: "Ship Friday" }], discrepancies: [] },
      actionItems: [{ owner: "Ann", task: "Send recap", due: "2026-07-10", done: false }],
    });
    expect(md).toContain("# Acme Sync");
    expect(md).toContain("We agreed on scope.");
    expect(md).toContain("- Ship Friday");
    expect(md).toContain("- [ ] @Ann — Send recap (due 2026-07-10)");
  });

  it("handles a sparse meeting with no summary or actions", () => {
    const md = meetingToMarkdown({
      title: "Quick chat", startTime: "2026-07-09T15:00:00.000Z", summary: null, actionItems: [],
    });
    expect(md).toContain("# Quick chat");
    expect(md).not.toContain("## Action items");
  });

  it("marks done items with a checked box and omits unassigned owner", () => {
    const md = meetingToMarkdown({
      title: "T", startTime: "2026-07-09T15:00:00.000Z", summary: null,
      actionItems: [{ owner: "unassigned", task: "Do thing", due: null, done: true }],
    });
    expect(md).toContain("- [x] Do thing");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd portal && npm test -- export.test`
Expected: FAIL — cannot find module `./export`.

- [ ] **Step 3: Implement `src/lib/meetings/export.ts`**

```ts
export type ExportSummary = {
  tldr: string;
  decisions: { text: string }[];
  discrepancies: { text: string }[];
} | null;

export type ExportAction = { owner: string; task: string; due: string | null; done: boolean };

function hasOwner(owner: string): boolean {
  const o = owner?.trim().toLowerCase();
  return !!o && o !== "unassigned";
}

export function meetingToMarkdown(input: {
  title: string;
  startTime: string;
  summary: ExportSummary;
  actionItems: ExportAction[];
}): string {
  const { title, startTime, summary, actionItems } = input;
  const out: string[] = [`# ${title}`, ""];

  const d = new Date(startTime);
  if (!isNaN(d.getTime())) out.push(`_${d.toLocaleString()}_`, "");

  if (summary?.tldr) out.push("## Summary", "", summary.tldr, "");

  if (summary?.decisions?.length) {
    out.push("## Decisions", "");
    for (const x of summary.decisions) out.push(`- ${x.text}`);
    out.push("");
  }

  if (summary?.discrepancies?.length) {
    out.push("## Open questions", "");
    for (const x of summary.discrepancies) out.push(`- ${x.text}`);
    out.push("");
  }

  if (actionItems.length) {
    out.push("## Action items", "");
    for (const a of actionItems) {
      const box = a.done ? "[x]" : "[ ]";
      const owner = hasOwner(a.owner) ? `@${a.owner.trim()} — ` : "";
      const due = a.due ? ` (due ${a.due})` : "";
      out.push(`- ${box} ${owner}${a.task}${due}`);
    }
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `cd portal && npm test -- export.test`
Expected: PASS.

- [ ] **Step 5: Implement the client actions component**

Create `src/components/meetings/MeetingExportActions.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

export function MeetingExportActions({ markdown, filename }: { markdown: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      download(); // fallback if clipboard is unavailable
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const btn = "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground";

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={copy} className={btn}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button type="button" onClick={download} className={btn}>
        <Download className="h-3.5 w-3.5" /> Export
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Accept an optional `markdown` prop in `MeetingHeader` and render the actions**

In `src/components/meetings/MeetingHeader.tsx`: add `markdown` to the props type and render `MeetingExportActions` next to the status badge. Change the props signature and the header row:

```tsx
import { MeetingExportActions } from "./MeetingExportActions";
// ...
export function MeetingHeader({
  title, startTime, endTime, meetUrl, botStatus, markdown,
}: { title: string; startTime: string; endTime: string | null; meetUrl: string | null; botStatus: string; markdown?: string }) {
  // ...
      <div className="mt-1 flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <div className="flex items-center gap-3">
          {markdown && <MeetingExportActions markdown={markdown} filename={`${title.replace(/[^\w.-]+/g, "-").toLowerCase() || "meeting"}.md`} />}
          <StatusBadge status={botStatus} />
        </div>
      </div>
```

- [ ] **Step 7: Build the markdown on the detail page and pass it in**

In `src/app/app/meetings/[id]/page.tsx`, after the data fetches and before the `return`, build the markdown, then pass it to `MeetingHeader`:

```tsx
import { meetingToMarkdown } from "@/lib/meetings/export";
// ...after actionItems/summary are fetched:
const exportMarkdown = meetingToMarkdown({
  title: meeting.title,
  startTime: meeting.start_time,
  summary: (summary as unknown as import("@/lib/meetings/export").ExportSummary) ?? null,
  actionItems: (actionItems ?? []) as import("@/lib/meetings/export").ExportAction[],
});
```

Then update the header usage:

```tsx
<MeetingHeader
  title={meeting.title}
  startTime={meeting.start_time}
  endTime={meeting.end_time}
  meetUrl={meeting.meet_url}
  botStatus={meeting.bot_status}
  markdown={exportMarkdown}
/>
```

- [ ] **Step 8: Verify tests, lint, and behavior**

Run: `cd portal && npm test -- export.test && npm run lint`
Expected: PASS. Then `npm run dev`, open a past meeting: **Copy** copies markdown, **Export** downloads `<slug>.md`.

- [ ] **Step 9: Commit**

```bash
cd portal && git add -A && git commit -m "feat(portal): copy/export meeting notes as Markdown"
```

---

## Task 6: In-transcript search

**Files:**
- Modify: `src/components/meetings/MeetingTimeline.tsx`

**Interfaces:**
- Consumes: existing `buildTimeline` items.
- Produces: no exported API change; adds internal search state + highlight.

- [ ] **Step 1: Add a search box and filter/highlight to the timeline**

In `src/components/meetings/MeetingTimeline.tsx`, add a `query` state and a highlight helper, filter the built items by matching speaker or text, and render a search input above the list. Add the import and helper near the top (after the existing imports):

```tsx
import { useState } from "react"; // extend existing import if useState already imported
```

Inside the component, after `const { items } = buildTimeline(segments, actions);`:

```tsx
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter(({ segment }) =>
        segment.text.toLowerCase().includes(q) || segment.speaker.toLowerCase().includes(q))
    : items;
```

Add a highlight helper above the `return` (module scope, below `clock`):

```tsx
function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase()
      ? <mark key={i} className="rounded bg-primary/20 text-foreground">{p}</mark>
      : <span key={i}>{p}</span>);
}
```

Replace the outer `return (<div className="space-y-4"> ... </div>)` so it includes the search box and maps over `shown` instead of `items`, and wraps the segment text with `highlight(...)`:

```tsx
  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search transcript…"
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lines match “{query}”.</p>
      ) : (
        shown.map(({ segment, actions: attached }) => {
          const isAgent = segment.speaker.trim().toLowerCase() === botName.trim().toLowerCase();
          return (
            <div key={segment.id} className="flex gap-3">
              <SpeakerAvatar name={segment.speaker} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold ${isAgent ? "text-primary" : "text-foreground"}`}>
                    {segment.speaker}{isAgent ? " · Steward" : ""}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{clock(segment.created_at)}</span>
                </div>
                <p className={`text-sm leading-relaxed ${isAgent ? "text-foreground/90" : "text-foreground"}`}>
                  {highlight(segment.text, q)}
                </p>
                <ActionStepStrip
                  actions={attached as unknown as AgentAction[]}
                  meetingId={meetingId}
                  onMutate={() => router.refresh()}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
```

Keep the existing empty-state (`if (!items.length) ...`) above this so a meeting with no transcript still shows the "No transcript captured." message and no search box.

- [ ] **Step 2: Verify lint + behavior**

Run: `cd portal && npm run lint`
Expected: PASS. Then `npm run dev`, open a meeting with a transcript: typing filters lines and highlights matches; clearing restores all.

- [ ] **Step 3: Commit**

```bash
cd portal && git add -A && git commit -m "feat(portal): in-transcript search with match highlighting"
```

---

## Task 7: Circleback-style meetings list rows

**Files:**
- Modify: `src/components/meetings/MeetingRow.tsx`

**Interfaces:**
- Consumes: existing `Meeting` shape; `page.tsx` already passes a `tldr` on grouped entries. Extend the row's `Meeting` type to accept optional `tldr`.
- Produces: no API change beyond an optional `tldr` field.

- [ ] **Step 1: Restyle the row (date column, title, one-line summary, quiet status)**

Replace `src/components/meetings/MeetingRow.tsx` with:

```tsx
import { OptInToggle } from "./OptInToggle";
import { StatusBadge } from "./StatusBadge";
import Link from "next/link";

type Meeting = {
  id: string;
  title: string;
  start_time: string;
  meet_url: string | null;
  opted_in: boolean;
  bot_status: string;
  tldr?: string | null;
};

export function MeetingRow({ meeting, isPast }: { meeting: Meeting; isPast: boolean }) {
  const start = new Date(meeting.start_time);
  const day = start.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const body = (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-secondary/40">
      <div className="w-14 shrink-0 text-center">
        <div className="text-xs font-semibold text-foreground">{day}</div>
        <div className="text-[11px] tabular-nums text-muted-foreground">{time}</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{meeting.title}</p>
        {meeting.tldr ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{meeting.tldr}</p>
        ) : !isPast && meeting.meet_url ? (
          <a href={meeting.meet_url} target="_blank" rel="noopener noreferrer"
            className="mt-0.5 inline-block text-sm text-primary hover:underline">Join ↗</a>
        ) : null}
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-3">
        <StatusBadge status={meeting.bot_status} />
        {!isPast && <OptInToggle meetingId={meeting.id} initialValue={meeting.opted_in} />}
      </div>
    </div>
  );

  return isPast ? (
    <Link href={`/app/meetings/${meeting.id}`} className="block">{body}</Link>
  ) : (
    body
  );
}
```

Note: past rows become fully clickable (whole card links to the meeting) — matching Circleback. Upcoming rows keep the inline opt-in toggle and are not links (the toggle is interactive). The `Meeting` type gains optional `tldr`; `app/app/page.tsx` already attaches `tldr` to entries, so pass it through if not already (verify the `MeetingRow` call site — the mapped `meetings` array already includes `tldr`, but one-off entries render `e.meeting` which may omit it; if so, add `tldr: tldrById.get(...)` when building the entry meetings — it is already merged in the `meetings` map on line 94-97, so `e.meeting.tldr` is present).

- [ ] **Step 2: Verify lint + behavior**

Run: `cd portal && npm run lint`
Expected: PASS. Then `npm run dev`, open `/app`: rows show date column + title + one-line summary; past rows are clickable; upcoming rows keep the opt-in toggle.

- [ ] **Step 3: Commit**

```bash
cd portal && git add -A && git commit -m "feat(portal): Circleback-style meeting list rows"
```

---

## Task 8: Final polish — action item assignee chips + verification pass

**Files:**
- Modify: `src/components/meetings/ActionItemsPanel.tsx`

**Interfaces:**
- Consumes: existing `ActionItem` shape.
- Produces: no API change; visual refinement so the per-meeting panel matches the global page's chip styling.

- [ ] **Step 1: Refine the per-meeting action item styling to match the global list**

In `src/components/meetings/ActionItemsPanel.tsx`, render the assignee as a chip and add a due chip, keeping the existing toggle logic. Replace the `<ul>...</ul>` return block with:

```tsx
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2.5">
          <Checkbox className="mt-0.5" checked={item.done} onCheckedChange={(v) => toggleDone(item.id, Boolean(v))} />
          <div className={`text-sm leading-relaxed ${item.done ? "text-muted-foreground line-through" : "text-foreground/90"}`}>
            {hasOwner(item.owner) && (
              <span className="mr-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                @{item.owner.trim()}
              </span>
            )}
            <span>{item.task}</span>
            {item.due ? <span className="ml-1.5 text-xs text-muted-foreground">due {item.due}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
```

- [ ] **Step 2: Full verification pass**

Run:
```bash
cd portal && npm test && npm run lint && npm run build
```
Expected: all tests PASS, lint clean, production build succeeds.

- [ ] **Step 3: Manual smoke test across surfaces**

`npm run dev`, then verify:
- Sidebar shows Chat · Meetings · Action items · Spaces · Connected Apps · Usage · Settings (no Ask).
- Theme toggle flips product light↔dark and persists on refresh; `/` landing stays dark.
- `/app` meeting rows restyled; past rows clickable.
- Meeting detail: Copy/Export work; transcript search filters + highlights.
- `/app/actions` lists items grouped Open/Done; toggling persists; meeting links work.

- [ ] **Step 4: Commit**

```bash
cd portal && git add -A && git commit -m "feat(portal): action item assignee chips + final redesign polish"
```

---

## Self-Review Notes (author)

- **Spec coverage:** nav/removal (T1), theme tokens+provider+toggle (T2/T3), meetings list restyle (T7), detail restructure — outline already present, action items chips (T8), transcript search (T6), copy/export (T5), global Action Items page (T4). Per-meeting ask box: intentionally dropped per user (Chat covers RAG). All spec sections mapped.
- **Type consistency:** `ActionRow` defined once in `lib/meetings/actions.ts`, consumed by `ActionItemsList` + page. `ExportSummary`/`ExportAction` defined once in `lib/meetings/export.ts`, consumed by the detail page + header. `Theme`/`THEME_COOKIE`/`parseTheme` defined once in `lib/theme.ts`.
- **Runtime checks flagged for the implementer:** (a) `action_items.user_id` existence in Task 6 note; (b) landing wrapper element in Task 2 Step 6; (c) `e.meeting.tldr` presence in Task 7 Step 1 — each has an inline fallback instruction.
