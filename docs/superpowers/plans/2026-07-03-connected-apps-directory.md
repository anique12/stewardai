# Connected Apps Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat connections list with a searchable, category-filtered apps directory grouped into Connected / Available / Coming soon — five Google apps live (with connected account + last-synced + reconnect), the rest shown as "coming soon".

**Architecture:** A pure `catalog.ts` data module (apps + `filterCatalog`) drives a redesigned client directory page that reuses the existing connect/disconnect handlers and `/api/integrations/status`; the three new Google toolkits are added to `SUPPORTED_TOOLKITS` so the generic routes handle them; the status route is enriched with a best-effort connected-account label.

**Tech Stack:** Next.js 14 App Router + TypeScript + Jest + Tailwind (portal). Composio v3 SDK (`@composio/core`).

## Global Constraints

- All work in `portal/`; run from `portal/`. Tests: `npm test` (Jest, ts-jest, node env, alias `^@/(.*)$`→`src/$1`).
- Portal TS tasks MUST pass `npx tsc --noEmit` before commit (the build runs tsc; Jest's transform does not enforce the target). No `for...of` over a `Map` (target lacks downlevelIteration — use `Array.from`/`.forEach`).
- Live apps (connectable) = the 5 Google slugs: `gmail`, `googlecalendar`, `googledrive`, `googledocs`, `googlesheets`. Coming-soon apps = `notion`, `slack`, `microsoftteams`, `zoom`, `jira`, `linear`, `hubspot`, `asana`, `outlook` — these MUST NOT be in `SUPPORTED_TOOLKITS` and have no connect action.
- Reuse the existing connect/disconnect flow and `/api/integrations/status` (RLS reads + service upsert already in place — do not change the auth pattern).
- Commit after each task.

---

### Task 1: App catalog + filter util + toolkit registration

**Files:**
- Create: `portal/src/lib/integrations/catalog.ts`
- Test: `portal/src/lib/__tests__/catalog.test.ts`
- Modify: `portal/src/lib/composio.ts` (`SUPPORTED_TOOLKITS`)

**Interfaces:**
- Produces:
  - `type Availability = "live" | "coming_soon"`.
  - `type AppCategory = "Email" | "Calendar" | "Docs" | "Storage" | "Comms" | "Project" | "CRM" | "Meetings"`.
  - `type CatalogApp = { slug: string; name: string; description: string; category: AppCategory; availability: Availability }`.
  - `CATALOG: CatalogApp[]`.
  - `filterCatalog(apps: CatalogApp[], query: string, category: AppCategory | "All"): CatalogApp[]`.
- `SUPPORTED_TOOLKITS` gains `googledrive`, `googledocs`, `googlesheets`.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/__tests__/catalog.test.ts`:

```ts
import { CATALOG, filterCatalog, type CatalogApp } from "@/lib/integrations/catalog";
import { SUPPORTED_TOOLKITS } from "@/lib/composio";

describe("CATALOG", () => {
  it("has the five live Google apps", () => {
    const live = CATALOG.filter((a) => a.availability === "live").map((a) => a.slug).sort();
    expect(live).toEqual(["gmail", "googlecalendar", "googledocs", "googledrive", "googlesheets"]);
  });
  it("every live app is a connectable toolkit; no coming-soon app is", () => {
    for (const a of CATALOG) {
      if (a.availability === "live") expect(SUPPORTED_TOOLKITS).toContain(a.slug);
      else expect(SUPPORTED_TOOLKITS).not.toContain(a.slug);
    }
  });
  it("lists notion and slack as coming soon", () => {
    const cs = CATALOG.filter((a) => a.availability === "coming_soon").map((a) => a.slug);
    expect(cs).toEqual(expect.arrayContaining(["notion", "slack"]));
  });
});

describe("filterCatalog", () => {
  const apps: CatalogApp[] = [
    { slug: "gmail", name: "Gmail", description: "email", category: "Email", availability: "live" },
    { slug: "slack", name: "Slack", description: "chat", category: "Comms", availability: "coming_soon" },
  ];
  it("returns all with empty query + All", () => {
    expect(filterCatalog(apps, "", "All")).toHaveLength(2);
  });
  it("matches by name case-insensitively", () => {
    expect(filterCatalog(apps, "GMAIL", "All").map((a) => a.slug)).toEqual(["gmail"]);
  });
  it("matches by description", () => {
    expect(filterCatalog(apps, "chat", "All").map((a) => a.slug)).toEqual(["slack"]);
  });
  it("filters by category", () => {
    expect(filterCatalog(apps, "", "Comms").map((a) => a.slug)).toEqual(["slack"]);
  });
  it("combines query and category", () => {
    expect(filterCatalog(apps, "gmail", "Comms")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npm test -- catalog`
Expected: FAIL — module `@/lib/integrations/catalog` not found.

- [ ] **Step 3: Implement the catalog**

Create `portal/src/lib/integrations/catalog.ts`:

```ts
export type Availability = "live" | "coming_soon";
export type AppCategory =
  | "Email" | "Calendar" | "Docs" | "Storage" | "Comms" | "Project" | "CRM" | "Meetings";
export type CatalogApp = {
  slug: string;
  name: string;
  description: string;
  category: AppCategory;
  availability: Availability;
};

export const CATALOG: CatalogApp[] = [
  { slug: "gmail", name: "Gmail", description: "Read, send, and manage email on your behalf.", category: "Email", availability: "live" },
  { slug: "googlecalendar", name: "Google Calendar", description: "Create and update events and check availability.", category: "Calendar", availability: "live" },
  { slug: "googledrive", name: "Google Drive", description: "Find, read, and organize files.", category: "Storage", availability: "live" },
  { slug: "googledocs", name: "Google Docs", description: "Read and draft documents.", category: "Docs", availability: "live" },
  { slug: "googlesheets", name: "Google Sheets", description: "Read and update spreadsheets.", category: "Docs", availability: "live" },
  { slug: "notion", name: "Notion", description: "Search, read, and write pages and databases.", category: "Docs", availability: "coming_soon" },
  { slug: "slack", name: "Slack", description: "Post messages and read channels.", category: "Comms", availability: "coming_soon" },
  { slug: "microsoftteams", name: "Microsoft Teams", description: "Chat and meetings for work.", category: "Comms", availability: "coming_soon" },
  { slug: "zoom", name: "Zoom", description: "Schedule and summarize video meetings.", category: "Meetings", availability: "coming_soon" },
  { slug: "jira", name: "Jira", description: "Track issues and sprints.", category: "Project", availability: "coming_soon" },
  { slug: "linear", name: "Linear", description: "Manage issues and projects.", category: "Project", availability: "coming_soon" },
  { slug: "hubspot", name: "HubSpot", description: "CRM contacts and deals.", category: "CRM", availability: "coming_soon" },
  { slug: "asana", name: "Asana", description: "Tasks and project workflows.", category: "Project", availability: "coming_soon" },
  { slug: "outlook", name: "Outlook", description: "Email and calendar for work.", category: "Email", availability: "coming_soon" },
];

export function filterCatalog(
  apps: CatalogApp[],
  query: string,
  category: AppCategory | "All",
): CatalogApp[] {
  const q = query.trim().toLowerCase();
  return apps.filter((a) => {
    const matchesCategory = category === "All" || a.category === category;
    const matchesQuery =
      !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });
}
```

- [ ] **Step 4: Register the new Google toolkits (and remove notion/slack)**

In `portal/src/lib/composio.ts`, set `SUPPORTED_TOOLKITS` to exactly the five live Google slugs — adding `googledrive`/`googledocs`/`googlesheets` and **removing** `notion`/`slack` (they become coming-soon and must not be connectable; the catalog test asserts coming-soon apps are absent here):

```ts
export const SUPPORTED_TOOLKITS = [
  "gmail",
  "googlecalendar",
  "googledrive",
  "googledocs",
  "googlesheets",
] as const;
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd portal && npm test -- catalog && npx tsc --noEmit`
Expected: all catalog tests pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add portal/src/lib/integrations/catalog.ts portal/src/lib/__tests__/catalog.test.ts portal/src/lib/composio.ts
git commit -m "feat(integrations): app catalog + filter util; register Google Drive/Docs/Sheets toolkits"
```

---

### Task 2: Status route — connected-account label

**Files:**
- Modify: `portal/src/app/api/integrations/status/route.ts`

**Interfaces:**
- Produces: each app object in the `{ apps: [...] }` response gains `account_label: string | null` (best-effort connected-account email/identifier from Composio; null when unavailable).

- [ ] **Step 1: Add label extraction from the Composio list**

READ the file first. It builds `byApp` from `composio.connectedAccounts.list({...}).items`. Add a small helper that extracts a human label from a connected-account item, defensively (Composio item shapes vary; never throw):

```ts
// Best-effort human label for a connected account (email/username), or null.
function accountLabel(account: Record<string, unknown>): string | null {
  const data = (account.data ?? account.params ?? {}) as Record<string, unknown>;
  const candidates = [
    (data as { email?: unknown }).email,
    (data as { username?: unknown }).username,
    (data as { login?: unknown }).login,
    (account as { email?: unknown }).email,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}
```

Change the `byApp` map to also carry the label. Where the loop currently does `byApp.set(slug, { id: account.id, status: account.status })`, capture the label too:

```ts
      const current = byApp.get(slug);
      if (!current || account.status === "ACTIVE") {
        byApp.set(slug, {
          id: account.id,
          status: account.status,
          label: accountLabel(account as unknown as Record<string, unknown>),
        });
      }
```

and widen the map's value type accordingly (`Map<string, { id: string; status: string; label: string | null }>`).

- [ ] **Step 2: Thread the label into the response rows**

The route reconciles into `connected_apps` and then returns rows. Add `account_label` to the returned objects WITHOUT persisting it (derive it from `byApp` at response time). In the final mapping that builds the JSON response (`rows`/`upserts`), include the label from `byApp.get(app)?.label ?? null` per app. Since the final read returns DB rows (which lack the label), build the response array by merging the DB rows with the in-memory `byApp` labels keyed by `app`:

```ts
  const { data: rows } = await db
    .from("connected_apps")
    .select("app,status,connected_account_id,connected_at,updated_at")
    .eq("user_id", user.id);

  const withLabels = (rows ?? []).map((r) => ({
    ...r,
    account_label: byApp.get(r.app)?.label ?? null,
  }));
  return NextResponse.json({ apps: withLabels });
```

Also update the error-fallback return (the catch branch that returns `existing`) to include `account_label: null` on each row so the response shape is consistent:

```ts
    const { data: existing } = await db
      .from("connected_apps")
      .select("app,status,connected_account_id,connected_at,updated_at")
      .eq("user_id", user.id);
    return NextResponse.json({
      apps: (existing ?? []).map((r) => ({ ...r, account_label: null })),
    });
```

- [ ] **Step 3: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add portal/src/app/api/integrations/status/route.ts
git commit -m "feat(integrations): return best-effort connected-account label from status"
```

---

### Task 3: `AppCard` + fallback icon

**Files:**
- Create: `portal/src/components/integrations/AppCard.tsx`

**Interfaces:**
- Consumes: `CatalogApp` (Task 1); existing `GmailIcon`/`GoogleCalendarIcon`/`NotionIcon`/`SlackIcon` from `@/components/landing/integration-icons`.
- Produces:
  - `type CardStatus = "connected" | "pending" | "error" | "disconnected" | "loading"`.
  - `AppCard({ app, status, accountLabel, connectedAt, busy, onConnect, onDisconnect }: { app: CatalogApp; status: CardStatus; accountLabel: string | null; connectedAt: string | null; busy: boolean; onConnect: () => void; onDisconnect: () => void })`.
  - `AppIcon({ slug }: { slug: string })` — brand icon for the four known slugs, else a neutral initial-letter tile.

- [ ] **Step 1: Implement**

Create `portal/src/components/integrations/AppCard.tsx`:

```tsx
"use client";
import {
  GmailIcon, GoogleCalendarIcon, NotionIcon, SlackIcon,
} from "@/components/landing/integration-icons";
import type { CatalogApp } from "@/lib/integrations/catalog";

export type CardStatus = "connected" | "pending" | "error" | "disconnected" | "loading";

export function AppIcon({ slug, name }: { slug: string; name: string }) {
  const cls = "h-6 w-6";
  const known: Record<string, React.ComponentType<{ className?: string }>> = {
    gmail: GmailIcon, googlecalendar: GoogleCalendarIcon, notion: NotionIcon, slack: SlackIcon,
  };
  const Brand = known[slug];
  if (Brand) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1.5">
        <Brand className={cls} />
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const STATUS_BADGE: Record<CardStatus, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-emerald-500/15 text-emerald-400" },
  pending: { label: "Pending", cls: "bg-yellow-500/15 text-yellow-400" },
  error: { label: "Needs reconnect", cls: "bg-red-500/15 text-red-400" },
  disconnected: { label: "Not connected", cls: "bg-muted text-muted-foreground" },
  loading: { label: "…", cls: "bg-muted text-muted-foreground" },
};

export function AppCard({
  app, status, accountLabel, connectedAt, busy, onConnect, onDisconnect,
}: {
  app: CatalogApp; status: CardStatus; accountLabel: string | null; connectedAt: string | null;
  busy: boolean; onConnect: () => void; onDisconnect: () => void;
}) {
  const comingSoon = app.availability === "coming_soon";
  const isConnected = status === "connected";
  const isError = status === "error";
  const badge = comingSoon ? { label: "Coming soon", cls: "bg-muted text-muted-foreground" } : STATUS_BADGE[status];

  const meta = isConnected
    ? [accountLabel, connectedAt ? `since ${new Date(connectedAt).toLocaleDateString()}` : null].filter(Boolean).join(" · ")
    : null;

  return (
    <div className={`flex flex-col gap-3 rounded-lg border border-border bg-card p-4 ${comingSoon ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={comingSoon ? "grayscale" : ""}><AppIcon slug={app.slug} name={app.name} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{app.name}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{app.description}</p>
          {meta ? <p className="mt-1 text-xs text-muted-foreground">{meta}</p> : null}
        </div>
      </div>

      <div className="mt-auto">
        {comingSoon ? (
          <button
            type="button"
            disabled
            title="Available soon"
            className="w-full cursor-not-allowed rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-70"
          >
            Coming soon
          </button>
        ) : isConnected ? (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={busy || status === "pending"}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Connecting…" : status === "pending" ? "Pending…" : isError ? "Reconnect" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/integrations/AppCard.tsx
git commit -m "feat(integrations): AppCard (live + coming-soon variants) with fallback icon"
```

---

### Task 4: Directory page rewrite

**Files:**
- Modify: `portal/src/app/app/settings/connections/page.tsx`

**Interfaces:**
- Consumes: `CATALOG`, `filterCatalog`, `AppCategory` (Task 1); `AppCard`, `CardStatus` (Task 3); the existing `/api/integrations/status|[app]/connect|[app]/disconnect` endpoints.

**Change summary:** Replace the whole component with a directory: search + category chips, status fetched on mount and window focus (keep the existing connect/disconnect handlers), and three grouped sections (Connected / Available / Coming soon) built from `filterCatalog(CATALOG, query, category)`.

- [ ] **Step 1: Rewrite the page**

Replace `portal/src/app/app/settings/connections/page.tsx` entirely:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppCard, type CardStatus } from "@/components/integrations/AppCard";
import { CATALOG, filterCatalog, type AppCategory, type CatalogApp } from "@/lib/integrations/catalog";

type StatusRow = { app: string; status: CardStatus; account_label: string | null; connected_at: string | null };

const CATEGORIES: (AppCategory | "All")[] = [
  "All", "Email", "Calendar", "Docs", "Storage", "Comms", "Project", "CRM", "Meetings",
];

export default function ConnectionsPage() {
  const [statusBySlug, setStatusBySlug] = useState<Map<string, StatusRow>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AppCategory | "All">("All");

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) return;
      const { apps } = (await res.json()) as { apps: StatusRow[] };
      setStatusBySlug(new Map(apps.map((r) => [r.app, r])));
    } catch {
      // keep last-known
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, [refreshStatus]);

  function statusFor(app: CatalogApp): CardStatus {
    if (app.availability === "coming_soon") return "disconnected";
    if (!loaded) return "loading";
    return statusBySlug.get(app.slug)?.status ?? "disconnected";
  }

  async function handleConnect(app: CatalogApp) {
    setBusySlug(app.slug);
    try {
      const redirectUri = `${window.location.origin}/app/settings/connections`;
      const res = await fetch(`/api/integrations/${app.slug}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectUri }),
      });
      if (!res.ok) { setBusySlug(null); return; }
      const { redirectUrl } = (await res.json()) as { redirectUrl: string | null };
      if (redirectUrl) window.location.href = redirectUrl;
      else setBusySlug(null);
    } catch { setBusySlug(null); }
  }

  async function handleDisconnect(app: CatalogApp) {
    setBusySlug(app.slug);
    try {
      await fetch(`/api/integrations/${app.slug}/disconnect`, { method: "POST" });
      await refreshStatus();
    } finally { setBusySlug(null); }
  }

  const filtered = useMemo(() => filterCatalog(CATALOG, query, category), [query, category]);
  const connected = filtered.filter((a) => a.availability === "live" && ["connected", "pending", "error"].includes(statusFor(a)));
  const available = filtered.filter((a) => a.availability === "live" && !connected.includes(a));
  const comingSoon = filtered.filter((a) => a.availability === "coming_soon");

  function renderCard(app: CatalogApp) {
    const row = statusBySlug.get(app.slug);
    return (
      <AppCard
        key={app.slug}
        app={app}
        status={statusFor(app)}
        accountLabel={row?.account_label ?? null}
        connectedAt={row?.connected_at ?? null}
        busy={busySlug === app.slug}
        onConnect={() => handleConnect(app)}
        onDisconnect={() => handleDisconnect(app)}
      />
    );
  }

  const Section = ({ title, apps }: { title: string; apps: CatalogApp[] }) =>
    apps.length ? (
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{apps.map(renderCard)}</div>
      </section>
    ) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Connected Apps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect services so Steward can act on your behalf.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps…"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                category === c ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {connected.length + available.length + comingSoon.length === 0 ? (
        <p className="text-sm text-muted-foreground">No apps match your search.</p>
      ) : (
        <div className="space-y-8">
          <Section title="Connected" apps={connected} />
          <Section title="Available" apps={available} />
          <Section title="Coming soon" apps={comingSoon} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + tests**

Run: `cd portal && npx tsc --noEmit && npm test`
Expected: zero type errors; all suites pass. (Note the `new Map(apps.map(...))` construction is fine; the code has no `for...of` over a Map.)

- [ ] **Step 3: Commit**

```bash
git add portal/src/app/app/settings/connections/page.tsx
git commit -m "feat(integrations): apps directory — search, categories, grouped sections"
```

---

### Task 5: Final verification

- [ ] **Step 1: Tests + build**

Run: `cd portal && npm test && npm run build`
Expected: all Jest suites pass; `next build` compiles with no lint/type errors. **Stop the dev server first** if running.

- [ ] **Step 2: Manual check**

Against a running dev server, at `/app/settings/connections`:
- The grid groups into Connected / Available / Coming soon; search narrows by name/description; category chips filter.
- A Google app (e.g. Gmail) connects via Composio OAuth and returns showing "Connected" with an account label/date; Disconnect works and the card returns to Available.
- Drive/Docs/Sheets appear under Available with a fallback letter tile and a working Connect button.
- Notion/Slack/etc. appear under Coming soon, grayscale, with a disabled "Coming soon" button (tooltip "Available soon").
- An `error`-status app shows a red "Needs reconnect" badge + "Reconnect" action.

- [ ] **Step 3: Commit any fixups** (only if needed)

```bash
git add -A portal && git commit -m "chore(integrations): directory verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §3.1 catalog + filter + toolkit registration → Task 1. ✅
- §3.2 status account label → Task 2. ✅
- §3.3 directory UI (search, categories, grouped sections, live vs coming-soon cards, reconnect) → Tasks 3, 4. ✅
- §3.4 connect/disconnect reuse → Task 4 (handlers) + generic routes (unchanged). ✅
- §4 error/empty/loading states → Task 3 (badges/variants) + Task 4 (loading, no-match, focus refresh). ✅
- §5 testing → Task 1 tests + Task 5. ✅
- §6 out of scope (agent tools, notify-me, extra icons) → honored (not built). ✅

**Placeholder scan:** No TBD/TODO; every step has real code + commands. ✅

**Type consistency:** `CatalogApp`/`Availability`/`AppCategory`/`filterCatalog` (Task 1) consumed by `AppCard` (Task 3) and the page (Task 4); `CardStatus` defined in Task 3 and used in Task 4; `account_label`/`connected_at` from Task 2's response consumed by Task 4's `StatusRow`. ✅

**Scope honesty:** Notion/Slack are intentionally downgraded to coming-soon (removed from `SUPPORTED_TOOLKITS`); Drive/Docs/Sheets are connectable but agent-tool enablement is out of scope; `account_label` is best-effort (null when Composio doesn't expose it).
