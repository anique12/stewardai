# Knowledge Base — Plan A2: Spaces Portal UI (L0 frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the KB visible and correctable in the portal — browse Spaces (nested), see a Space's meetings + rolled-up facts + people/companies, review the Unfiled tray, and file/move a meeting into a Space (which also teaches the filing loop).

**Architecture:** Next.js App Router pages under `portal/src/app/app/spaces/` that read via the RLS-scoped `createServerClient()` (mirroring the meetings pages), plus Next route handlers under `portal/src/app/api/` that mutate via `createServiceClient()` with manual ownership re-checks (mirroring the actions approve/dismiss routes). All non-trivial logic (space tree, fact grouping, filing-hint derivation) is factored into pure `portal/src/lib/spaces/*` functions, unit-tested with Jest. Reuses the existing `groupMeetings`/`SeriesCard`/`MeetingRow`, the shadcn UI kit, `PageHeader`, and `StatusBadge`.

**Tech Stack:** Next.js 14 App Router (RSC), TypeScript, `@supabase/ssr` (anon+cookies for reads) / `@supabase/supabase-js` (service role for writes), Tailwind + `cn()`, Jest + ts-jest.

## Global Constraints

- Reads use `createServerClient()` (RLS-scoped) in server components; every query ALSO adds `.eq("user_id", user.id)` explicitly. Pages set `export const dynamic = "force-dynamic";` and start with `await requireUserPage()`.
- Mutations are Next route handlers under `portal/src/app/api/…` using `requireUserRoute()` (early-return its `response` on 401) + `createServiceClient()`, and MUST re-check ownership with `.eq("user_id", user.id)` on both the verifying SELECT and the UPDATE/INSERT (service role bypasses RLS). Response shape: `NextResponse.json({ success: true })` or `NextResponse.json({ error }, { status })`.
- Path alias `@/* → portal/src/*`. Pure logic lives in `portal/src/lib/spaces/*` and is unit-tested (`portal/src/lib/__tests__/*.test.ts`, ts-jest, `describe/it/expect`, typed fixture factory). Pages/components/route-handlers are NOT unit-tested (repo convention) — they're verified by `npx tsc --noEmit` + `npm run build` + a documented browser check.
- Schema is `portal/supabase/migrations/0009_knowledge_base.sql` (already applied assumption for browser checks). `space_source` ∈ `recurring|auto|auto_created|manual|suggested|unfiled`. `spaces.kind` ∈ `client|project|topic` (nullable). `spaces.status` ∈ `active|archived`.
- **The Unfiled tray = meetings where `space_source IN ('suggested','unfiled')` OR `space_id IS NULL`.** A "filed" meeting has `space_source IN ('recurring','auto','auto_created','manual')` with a non-null `space_id`.
- Manual filing sets `space_source='manual'`, `space_confidence=1.0`, re-parents the meeting's `space_facts` to the new space, and reinforces `filing_hints` from the meeting's linked entities (the learning loop).
- Run portal commands from `portal/`: `npm test` (jest), `npx tsc --noEmit`, `npm run build`. Run tsc/build after component tasks (Jest's ts-jest transform does NOT type-check the app).
- DRY, YAGNI, TDD (for libs), frequent commits. Out of scope for A2 (later): rename/archive UI, tag editing, cross-Space entity history page, the L3 living brief.

---

### Task 1: Space-tree lib (pure) + Spaces list page + sidebar nav

**Files:**
- Create: `portal/src/lib/spaces/tree.ts`
- Test: `portal/src/lib/__tests__/spaces-tree.test.ts`
- Create: `portal/src/app/app/spaces/page.tsx`
- Create: `portal/src/components/spaces/SpaceCard.tsx`
- Modify: `portal/src/components/app-shell/Sidebar.tsx` (add the "Spaces" NAV item)

**Interfaces:**
- Produces: `SpaceRow` type; `SpaceNode = SpaceRow & { children: SpaceNode[] }`; `buildSpaceTree(spaces: SpaceRow[]): SpaceNode[]` (roots = parent_id null or parent not in set; children nested under parents; each level sorted by name, case-insensitive).

- [ ] **Step 1: Write the failing test**

```ts
// portal/src/lib/__tests__/spaces-tree.test.ts
import { buildSpaceTree, type SpaceRow } from "@/lib/spaces/tree";

const s = (over: Partial<SpaceRow>): SpaceRow => ({
  id: "x", name: "X", parent_id: null, kind: null, status: "active", ...over,
});

describe("buildSpaceTree", () => {
  it("nests children under parents and sorts each level by name (case-insensitive)", () => {
    const rows = [
      s({ id: "acme", name: "Acme" }),
      s({ id: "renewal", name: "q3 renewal", parent_id: "acme" }),
      s({ id: "hiring", name: "hiring" }),
      s({ id: "onboard", name: "Onboarding", parent_id: "acme" }),
    ];
    const tree = buildSpaceTree(rows);
    expect(tree.map((n) => n.id)).toEqual(["acme", "hiring"]); // roots sorted: Acme, hiring
    expect(tree[0].children.map((n) => n.id)).toEqual(["onboard", "renewal"]); // Onboarding, q3 renewal
  });

  it("treats a space whose parent is missing/archived-out as a root", () => {
    const tree = buildSpaceTree([s({ id: "orphan", name: "Orphan", parent_id: "gone" })]);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
  });

  it("returns [] for no spaces", () => {
    expect(buildSpaceTree([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npx jest spaces-tree`
Expected: FAIL — cannot find module `@/lib/spaces/tree`.

- [ ] **Step 3: Implement the lib**

```ts
// portal/src/lib/spaces/tree.ts
export type SpaceRow = {
  id: string;
  name: string;
  parent_id: string | null;
  kind: "client" | "project" | "topic" | null;
  status: "active" | "archived";
};

export type SpaceNode = SpaceRow & { children: SpaceNode[] };

/** Build a nested, name-sorted tree from a flat space list. A space whose
 *  parent_id is null or points at a space not in the list becomes a root. */
export function buildSpaceTree(spaces: SpaceRow[]): SpaceNode[] {
  const byId = new Map<string, SpaceNode>();
  for (const s of spaces) byId.set(s.id, { ...s, children: [] });
  const roots: SpaceNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: SpaceNode[]) => {
    nodes.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npx jest spaces-tree`
Expected: PASS (3 passed).

- [ ] **Step 5: Add the SpaceCard component**

```tsx
// portal/src/components/spaces/SpaceCard.tsx
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SpaceNode } from "@/lib/spaces/tree";

export function SpaceCard({
  node,
  meetingCount,
  openFactsCount,
}: {
  node: SpaceNode;
  meetingCount: number;
  openFactsCount: number;
}) {
  return (
    <Link href={`/app/spaces/${node.id}`} className="block">
      <Card className="p-4 transition-colors hover:bg-accent">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium">{node.name}</h3>
          {node.kind ? <Badge variant="outline">{node.kind}</Badge> : null}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {meetingCount} meeting{meetingCount === 1 ? "" : "s"}
          {openFactsCount > 0 ? ` · ${openFactsCount} open` : ""}
        </p>
        {node.children.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {node.children.map((c) => c.name).join(" · ")}
          </p>
        ) : null}
      </Card>
    </Link>
  );
}
```

- [ ] **Step 6: Add the Spaces list page**

```tsx
// portal/src/app/app/spaces/page.tsx
import Link from "next/link";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { Card } from "@/components/ui/card";
import { buildSpaceTree, type SpaceRow } from "@/lib/spaces/tree";
import { SpaceCard } from "@/components/spaces/SpaceCard";

export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const user = await requireUserPage();
  const db = createServerClient();

  const [{ data: spaces }, { data: filedMeetings }, { data: facts }, { data: unfiled }] =
    await Promise.all([
      db.from("spaces").select("id,name,parent_id,kind,status").eq("user_id", user.id).eq("status", "active"),
      db.from("meetings").select("space_id").eq("user_id", user.id).not("space_id", "is", null),
      db.from("space_facts").select("space_id").eq("user_id", user.id).is("superseded_by", null),
      db.from("meetings").select("id").eq("user_id", user.id).in("space_source", ["suggested", "unfiled"]),
    ]);

  const meetingCounts = new Map<string, number>();
  for (const m of filedMeetings ?? []) if (m.space_id) meetingCounts.set(m.space_id, (meetingCounts.get(m.space_id) ?? 0) + 1);
  const factCounts = new Map<string, number>();
  for (const f of facts ?? []) factCounts.set(f.space_id, (factCounts.get(f.space_id) ?? 0) + 1);

  const tree = buildSpaceTree((spaces ?? []) as SpaceRow[]);
  const unfiledCount = unfiled?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Spaces" subtitle="Your work, organized into threads." />

      {unfiledCount > 0 ? (
        <Link href="/app/spaces/unfiled" className="block">
          <Card className="border-amber-500/40 bg-amber-500/5 p-4 transition-colors hover:bg-amber-500/10">
            <p className="text-sm font-medium text-amber-500">
              {unfiledCount} meeting{unfiledCount === 1 ? "" : "s"} to review →
            </p>
            <p className="text-xs text-muted-foreground">Confirm or correct where these belong.</p>
          </Card>
        </Link>
      ) : null}

      {tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No spaces yet. They&apos;re created automatically as Steward organizes your meetings.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tree.map((node) => (
            <SpaceCard
              key={node.id}
              node={node}
              meetingCount={meetingCounts.get(node.id) ?? 0}
              openFactsCount={factCounts.get(node.id) ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Add "Spaces" to the sidebar nav**

In `portal/src/components/app-shell/Sidebar.tsx`: import `Layers` from `lucide-react` (add to the existing lucide import line), and add this item to the `NAV` array immediately after the "Meetings" entry:

```tsx
  { href: "/app/spaces", label: "Spaces", icon: Layers, isActive: (p) => p.startsWith("/app/spaces") },
```

- [ ] **Step 8: Verify + commit**

Run: `cd portal && npx jest spaces-tree && npx tsc --noEmit && npm run build`
Expected: jest 3 passed; tsc clean; build "Compiled successfully" with a `/app/spaces` route listed.
Browser check (note for the human): `/app/spaces` shows a card per active root space with meeting/open counts, the Unfiled banner when applicable, and a "Spaces" sidebar item that highlights on the route.

```bash
cd /Users/aniquesabir/projects/stewardai
git add portal/src/lib/spaces/tree.ts portal/src/lib/__tests__/spaces-tree.test.ts portal/src/app/app/spaces/page.tsx portal/src/components/spaces/SpaceCard.tsx portal/src/components/app-shell/Sidebar.tsx
git commit -m "feat(spaces): Spaces list page + nested tree + sidebar nav"
```

---

### Task 2: Fact-grouping lib (pure) + SpaceFactsPanel

**Files:**
- Create: `portal/src/lib/spaces/facts.ts`
- Test: `portal/src/lib/__tests__/spaces-facts.test.ts`
- Create: `portal/src/components/spaces/SpaceFactsPanel.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `FactRow` type; `GroupedFacts = { action_item: FactRow[]; decision: FactRow[]; date: FactRow[]; risk: FactRow[]; open_question: FactRow[] }`; `groupFacts(facts: FactRow[]): GroupedFacts` (drops rows where `superseded_by` is set; groups by `kind`; preserves input order within a kind).

- [ ] **Step 1: Write the failing test**

```ts
// portal/src/lib/__tests__/spaces-facts.test.ts
import { groupFacts, type FactRow } from "@/lib/spaces/facts";

const f = (over: Partial<FactRow>): FactRow => ({
  id: "x", kind: "decision", text: "T", owner: null, due: null, status: null,
  meeting_id: "m1", source_seq: null, superseded_by: null, ...over,
});

describe("groupFacts", () => {
  it("buckets by kind and drops superseded rows", () => {
    const g = groupFacts([
      f({ id: "d1", kind: "decision", text: "Dropped tier-3" }),
      f({ id: "r1", kind: "risk", text: "Renewal at risk" }),
      f({ id: "d2", kind: "decision", text: "old", superseded_by: "d1" }),
      f({ id: "a1", kind: "action_item", text: "Send quote" }),
    ]);
    expect(g.decision.map((x) => x.id)).toEqual(["d1"]); // d2 superseded → dropped
    expect(g.risk.map((x) => x.id)).toEqual(["r1"]);
    expect(g.action_item.map((x) => x.id)).toEqual(["a1"]);
    expect(g.date).toEqual([]);
    expect(g.open_question).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npx jest spaces-facts`
Expected: FAIL — cannot find module `@/lib/spaces/facts`.

- [ ] **Step 3: Implement the lib**

```ts
// portal/src/lib/spaces/facts.ts
export type FactKind = "action_item" | "decision" | "date" | "risk" | "open_question";

export type FactRow = {
  id: string;
  kind: FactKind;
  text: string;
  owner: string | null;
  due: string | null;
  status: string | null;
  meeting_id: string | null;
  source_seq: number | null;
  superseded_by: string | null;
};

export type GroupedFacts = Record<FactKind, FactRow[]>;

const EMPTY = (): GroupedFacts => ({
  action_item: [], decision: [], date: [], risk: [], open_question: [],
});

/** Group live (non-superseded) facts by kind, preserving input order per kind. */
export function groupFacts(facts: FactRow[]): GroupedFacts {
  const out = EMPTY();
  for (const fact of facts) {
    if (fact.superseded_by) continue;
    if (fact.kind in out) out[fact.kind].push(fact);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npx jest spaces-facts`
Expected: PASS (1 passed).

- [ ] **Step 5: Add the SpaceFactsPanel component**

```tsx
// portal/src/components/spaces/SpaceFactsPanel.tsx
import Link from "next/link";
import { groupFacts, type FactRow, type FactKind } from "@/lib/spaces/facts";

const SECTIONS: { kind: FactKind; label: string }[] = [
  { kind: "action_item", label: "Open items" },
  { kind: "decision", label: "Decisions" },
  { kind: "date", label: "Key dates" },
  { kind: "risk", label: "Risks" },
  { kind: "open_question", label: "Open questions" },
];

export function SpaceFactsPanel({ facts }: { facts: FactRow[] }) {
  const grouped = groupFacts(facts);
  const anything = SECTIONS.some((s) => grouped[s.kind].length > 0);
  if (!anything) {
    return <p className="text-sm text-muted-foreground">No facts captured yet.</p>;
  }
  return (
    <div className="space-y-4">
      {SECTIONS.map(({ kind, label }) => {
        const rows = grouped[kind];
        if (rows.length === 0) return null;
        return (
          <div key={kind}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.id} className="text-sm">
                  {/* Provenance: link back to the source meeting when known */}
                  {r.meeting_id ? (
                    <Link href={`/app/meetings/${r.meeting_id}`} className="hover:underline">
                      {r.text}
                    </Link>
                  ) : (
                    r.text
                  )}
                  {r.due ? <span className="text-muted-foreground"> · {r.due}</span> : null}
                  {r.owner ? <span className="text-muted-foreground"> · {r.owner}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Verify + commit**

Run: `cd portal && npx jest spaces-facts && npx tsc --noEmit`
Expected: jest 1 passed; tsc clean.

```bash
cd /Users/aniquesabir/projects/stewardai
git add portal/src/lib/spaces/facts.ts portal/src/lib/__tests__/spaces-facts.test.ts portal/src/components/spaces/SpaceFactsPanel.tsx
git commit -m "feat(spaces): fact grouping lib + SpaceFactsPanel"
```

---

### Task 3: Space detail page (meetings + facts + entities)

**Files:**
- Create: `portal/src/app/app/spaces/[id]/page.tsx`
- Create: `portal/src/components/spaces/SpaceEntities.tsx`

**Interfaces:**
- Consumes: `buildSpaceTree`/`SpaceRow` (Task 1), `SpaceFactsPanel`+`FactRow` (Task 2), `groupMeetings` + `SeriesCard`/`MeetingRow` (existing `@/lib/meetings/series`), `PageHeader`, `Badge`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the SpaceEntities component**

```tsx
// portal/src/components/spaces/SpaceEntities.tsx
import { Badge } from "@/components/ui/badge";

export type SpaceEntity = { id: string; kind: "person" | "company"; name: string; email: string | null };

export function SpaceEntities({ entities }: { entities: SpaceEntity[] }) {
  if (entities.length === 0) return <p className="text-sm text-muted-foreground">No people or companies yet.</p>;
  const people = entities.filter((e) => e.kind === "person");
  const companies = entities.filter((e) => e.kind === "company");
  return (
    <div className="space-y-3">
      {companies.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {companies.map((c) => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
        </div>
      ) : null}
      {people.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {people.map((p) => <Badge key={p.id} variant="outline">{p.name}</Badge>)}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add the Space detail page**

```tsx
// portal/src/app/app/spaces/[id]/page.tsx
import { notFound } from "next/navigation";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SpaceFactsPanel } from "@/components/spaces/SpaceFactsPanel";
import { SpaceEntities, type SpaceEntity } from "@/components/spaces/SpaceEntities";
import type { FactRow } from "@/lib/spaces/facts";
import { groupMeetings } from "@/lib/meetings/series";
import { SeriesCard } from "@/components/meetings/SeriesCard";
import { MeetingRow } from "@/components/meetings/MeetingRow";

export const dynamic = "force-dynamic";

export default async function SpaceDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUserPage();
  const db = createServerClient();

  const { data: space } = await db
    .from("spaces").select("id,name,kind,status")
    .eq("id", params.id).eq("user_id", user.id).single();
  if (!space) notFound();

  const [{ data: meetings }, { data: facts }] = await Promise.all([
    db.from("meetings")
      .select("id,title,start_time,meet_url,opted_in,bot_status,recurring_event_id,google_event_id")
      .eq("user_id", user.id).eq("space_id", params.id).order("start_time", { ascending: false }),
    db.from("space_facts")
      .select("id,kind,text,owner,due,status,meeting_id,source_seq,superseded_by")
      .eq("user_id", user.id).eq("space_id", params.id).order("created_at"),
  ]);

  // Entities for THIS space = entities linked to any of the space's meetings (deduped).
  // Run after meetings resolve, since we filter by their ids.
  const meetingIds = (meetings ?? []).map((m) => m.id);
  let entities: SpaceEntity[] = [];
  if (meetingIds.length > 0) {
    const { data: entLinks } = await db
      .from("meeting_entities")
      .select("entities(id,kind,name,email)")
      .eq("user_id", user.id).in("meeting_id", meetingIds);
    const byId = new Map<string, SpaceEntity>();
    for (const row of entLinks ?? []) {
      const e = (row as unknown as { entities: SpaceEntity | null }).entities;
      if (e) byId.set(e.id, e);
    }
    entities = [...byId.values()];
  }

  const now = new Date().toISOString();
  const entries = groupMeetings(
    (meetings ?? []).map((m) => ({ ...m, tldr: null })),
    now
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={space.name}
        subtitle={space.status === "archived" ? "Archived" : undefined}
        action={space.kind ? <Badge variant="outline">{space.kind}</Badge> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Meetings</h2>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings filed here yet.</p>
          ) : (
            entries.map((e) =>
              e.kind === "series" ? (
                <SeriesCard key={e.key} entry={e} />
              ) : (
                <MeetingRow key={e.meeting.id} meeting={e.meeting} isPast={e.meeting.start_time < now} />
              )
            )
          )}
        </div>
        <aside className="space-y-6">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">What&apos;s known</h2>
            <SpaceFactsPanel facts={(facts ?? []) as FactRow[]} />
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">People &amp; companies</h2>
            <SpaceEntities entities={entities} />
          </Card>
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `cd portal && npx tsc --noEmit && npm run build`
Expected: tsc clean; build ok with `/app/spaces/[id]` route.
Browser check: open a Space → shows its meetings (grouped like the home page), the facts panel grouped by kind with source-meeting links, and its people/companies.

```bash
cd /Users/aniquesabir/projects/stewardai
git add portal/src/app/app/spaces/[id]/page.tsx portal/src/components/spaces/SpaceEntities.tsx
git commit -m "feat(spaces): Space detail page (meetings + facts + entities)"
```

---

### Task 4: Filing-hint derivation lib (pure) + file-a-meeting route

**Files:**
- Create: `portal/src/lib/spaces/hints.ts`
- Test: `portal/src/lib/__tests__/spaces-hints.test.ts`
- Create: `portal/src/app/api/meetings/[id]/space/route.ts`

**Interfaces:**
- Consumes: nothing (lib is pure).
- Produces: `HintEntity` type; `FilingHintRow` type; `deriveHints(entities: HintEntity[], spaceId: string, userId: string): FilingHintRow[]` — a person with an email → `{kind:'attendee_email', value:<lower email>}`; a company with a domain (or email domain) → `{kind:'domain', value:<lower domain>}`; deduped; each row `{user_id, kind, value, space_id, weight:1}`. Used by the file-meeting route to teach the loop.
- Produces (HTTP): `PUT /api/meetings/:id/space` body `{ "space_id": "<uuid>" }` → files the meeting into that space (source `manual`), re-parents its facts, upserts hints. Returns `{ success: true }`.

- [ ] **Step 1: Write the failing test**

```ts
// portal/src/lib/__tests__/spaces-hints.test.ts
import { deriveHints, type HintEntity } from "@/lib/spaces/hints";

const e = (over: Partial<HintEntity>): HintEntity => ({ kind: "person", email: null, domain: null, ...over });

describe("deriveHints", () => {
  it("maps person email → attendee_email and company domain → domain, lower-cased + deduped", () => {
    const rows = deriveHints(
      [
        e({ kind: "person", email: "Jane@Acme.com" }),
        e({ kind: "person", email: "jane@acme.com" }), // dup after lower-casing
        e({ kind: "company", domain: "ACME.com" }),
        e({ kind: "company", email: "x@globex.io", domain: null }), // domain from email
        e({ kind: "person", email: null }), // no signal → skipped
      ],
      "space-1",
      "user-1"
    );
    expect(rows).toEqual([
      { user_id: "user-1", kind: "attendee_email", value: "jane@acme.com", space_id: "space-1", weight: 1 },
      { user_id: "user-1", kind: "domain", value: "acme.com", space_id: "space-1", weight: 1 },
      { user_id: "user-1", kind: "domain", value: "globex.io", space_id: "space-1", weight: 1 },
    ]);
  });

  it("returns [] when nothing has a usable signal", () => {
    expect(deriveHints([e({ kind: "person", email: null })], "s", "u")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npx jest spaces-hints`
Expected: FAIL — cannot find module `@/lib/spaces/hints`.

- [ ] **Step 3: Implement the lib**

```ts
// portal/src/lib/spaces/hints.ts
export type HintEntity = {
  kind: "person" | "company";
  email: string | null;
  domain: string | null;
};

export type FilingHintRow = {
  user_id: string;
  kind: "attendee_email" | "domain";
  value: string;
  space_id: string;
  weight: number;
};

function domainOf(email: string | null): string | null {
  if (email && email.includes("@")) return email.split("@", 2)[1].trim().toLowerCase() || null;
  return null;
}

/** Derive filing_hints rows teaching that these entities → this space. A person's
 *  email becomes an attendee_email hint; a company's domain (explicit or from its
 *  email) becomes a domain hint. Values are lower-cased and de-duplicated. */
export function deriveHints(entities: HintEntity[], spaceId: string, userId: string): FilingHintRow[] {
  const seen = new Set<string>();
  const rows: FilingHintRow[] = [];
  const push = (kind: "attendee_email" | "domain", raw: string | null) => {
    if (!raw) return;
    const value = raw.trim().toLowerCase();
    if (!value) return;
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ user_id: userId, kind, value, space_id: spaceId, weight: 1 });
  };
  for (const ent of entities) {
    if (ent.kind === "person") push("attendee_email", ent.email);
    else if (ent.kind === "company") push("domain", ent.domain ?? domainOf(ent.email));
  }
  return rows;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npx jest spaces-hints`
Expected: PASS (2 passed).

- [ ] **Step 5: Add the file-a-meeting route handler**

```ts
// portal/src/app/api/meetings/[id]/space/route.ts
import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { deriveHints, type HintEntity } from "@/lib/spaces/hints";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  let spaceId: string | null = null;
  try {
    const body = await request.json();
    spaceId = typeof body?.space_id === "string" ? body.space_id : null;
  } catch {
    // fall through → 400 below
  }
  if (!spaceId) return NextResponse.json({ error: "space_id required" }, { status: 400 });

  const service = createServiceClient();

  // Ownership: the meeting AND the target space must belong to the user.
  const [{ data: meeting }, { data: space }] = await Promise.all([
    service.from("meetings").select("id").eq("id", params.id).eq("user_id", user.id).single(),
    service.from("spaces").select("id").eq("id", spaceId).eq("user_id", user.id).single(),
  ]);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });

  // 1) File the meeting (manual → confident, correctable).
  const { error: updErr } = await service
    .from("meetings")
    .update({ space_id: spaceId, space_source: "manual", space_confidence: 1.0 })
    .eq("id", params.id).eq("user_id", user.id);
  if (updErr) return NextResponse.json({ error: "Failed to file meeting" }, { status: 500 });

  // 2) Re-parent this meeting's facts to the new space (correction moves provenance).
  await service.from("space_facts").update({ space_id: spaceId })
    .eq("meeting_id", params.id).eq("user_id", user.id);

  // 3) Teach the filing loop from the meeting's linked entities (best-effort).
  const { data: entLinks } = await service
    .from("meeting_entities").select("entities(kind,email,domain)")
    .eq("meeting_id", params.id).eq("user_id", user.id);
  const entities = (entLinks ?? [])
    .map((row) => (row as unknown as { entities: HintEntity | null }).entities)
    .filter((e): e is HintEntity => !!e);
  const hints = deriveHints(entities, spaceId, user.id);
  if (hints.length > 0) {
    await service.from("filing_hints").upsert(hints, { onConflict: "user_id,kind,value,space_id" });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 6: Verify + commit**

Run: `cd portal && npx jest spaces-hints && npx tsc --noEmit`
Expected: jest 2 passed; tsc clean.

```bash
cd /Users/aniquesabir/projects/stewardai
git add portal/src/lib/spaces/hints.ts portal/src/lib/__tests__/spaces-hints.test.ts "portal/src/app/api/meetings/[id]/space/route.ts"
git commit -m "feat(spaces): file-a-meeting route + filing-hint derivation (learning loop)"
```

---

### Task 5: FileMeetingControl + Unfiled tray page

**Files:**
- Create: `portal/src/components/spaces/FileMeetingControl.tsx`
- Create: `portal/src/app/app/spaces/unfiled/page.tsx`

**Interfaces:**
- Consumes: the `PUT /api/meetings/:id/space` route (Task 4); shadcn `Button`, `Card`.
- Produces: `<FileMeetingControl meetingId spaces suggestedSpaceId? suggestedSpaceName? />` — a client control that PUTs the chosen space then refreshes.

- [ ] **Step 1: Add the FileMeetingControl (client) component**

```tsx
// portal/src/components/spaces/FileMeetingControl.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export type SpaceOption = { id: string; name: string };

export function FileMeetingControl({
  meetingId,
  spaces,
  suggestedSpaceId,
  suggestedSpaceName,
}: {
  meetingId: string;
  spaces: SpaceOption[];
  suggestedSpaceId?: string | null;
  suggestedSpaceName?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function file(spaceId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/space`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_id: spaceId }),
      });
      if (res.ok) router.refresh();
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggestedSpaceId ? (
        <Button size="sm" disabled={busy} onClick={() => file(suggestedSpaceId)}>
          {busy ? "Filing…" : `Confirm: ${suggestedSpaceName ?? "suggested"}`}
        </Button>
      ) : null}
      {picking ? (
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          disabled={busy}
          defaultValue=""
          onChange={(e) => e.target.value && file(e.target.value)}
        >
          <option value="" disabled>Pick a space…</option>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPicking(true)}>
          {suggestedSpaceId ? "Choose another" : "File…"}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the Unfiled tray page**

```tsx
// portal/src/app/app/spaces/unfiled/page.tsx
import Link from "next/link";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { Card } from "@/components/ui/card";
import { FileMeetingControl, type SpaceOption } from "@/components/spaces/FileMeetingControl";

export const dynamic = "force-dynamic";

export default async function UnfiledPage() {
  const user = await requireUserPage();
  const db = createServerClient();

  const [{ data: meetings }, { data: spaces }] = await Promise.all([
    db.from("meetings")
      .select("id,title,start_time,space_id,space_source")
      .eq("user_id", user.id).in("space_source", ["suggested", "unfiled"])
      .order("start_time", { ascending: false }),
    db.from("spaces").select("id,name").eq("user_id", user.id).eq("status", "active").order("name"),
  ]);

  const spaceOptions = (spaces ?? []) as SpaceOption[];
  const nameById = new Map(spaceOptions.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Unfiled" subtitle="Confirm or correct where these meetings belong." />
      {(meetings ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing to review — <Link href="/app/spaces" className="hover:underline">back to Spaces</Link>.
        </p>
      ) : (
        <div className="space-y-3">
          {(meetings ?? []).map((m) => {
            // A 'suggested' meeting already has its best-guess space_id; offer it as a one-tap confirm.
            const suggestedId = m.space_source === "suggested" ? m.space_id : null;
            return (
              <Card key={m.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link href={`/app/meetings/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
                    <p className="text-xs text-muted-foreground">{new Date(m.start_time).toLocaleString()}</p>
                  </div>
                  <FileMeetingControl
                    meetingId={m.id}
                    spaces={spaceOptions}
                    suggestedSpaceId={suggestedId}
                    suggestedSpaceName={suggestedId ? nameById.get(suggestedId) ?? null : null}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `cd portal && npx tsc --noEmit && npm run build`
Expected: tsc clean; build ok with `/app/spaces/unfiled`.
Browser check: the tray lists suggested+unfiled meetings; "Confirm: <name>" one-taps a suggested one; "File…"/"Choose another" opens a picker; filing removes the meeting from the tray (router.refresh).

```bash
cd /Users/aniquesabir/projects/stewardai
git add portal/src/components/spaces/FileMeetingControl.tsx portal/src/app/app/spaces/unfiled/page.tsx
git commit -m "feat(spaces): Unfiled tray + file/confirm control"
```

---

### Task 6: Create-space route + New Space dialog

**Files:**
- Create: `portal/src/app/api/spaces/route.ts`
- Create: `portal/src/components/spaces/NewSpaceDialog.tsx`
- Modify: `portal/src/app/app/spaces/page.tsx` (add the New Space action to the header)

**Interfaces:**
- Consumes: shadcn `Dialog`, `Input`, `Button`, `Label`.
- Produces (HTTP): `POST /api/spaces` body `{ "name": string, "kind"?: "client"|"project"|"topic" }` → inserts a space (user-scoped, status active), returns `{ success: true, id }`.

- [ ] **Step 1: Add the create-space route**

```ts
// portal/src/app/api/spaces/route.ts
import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";

const KINDS = new Set(["client", "project", "topic"]);

export async function POST(request: NextRequest) {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  let name = "";
  let kind: string | null = null;
  try {
    const body = await request.json();
    name = typeof body?.name === "string" ? body.name.trim() : "";
    kind = typeof body?.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
  } catch {
    // fall through → 400
  }
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from("spaces")
    .insert({ user_id: user.id, name, kind })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "Failed to create space" }, { status: 500 });

  return NextResponse.json({ success: true, id: data.id });
}
```

- [ ] **Step 2: Add the NewSpaceDialog (client) component**

```tsx
// portal/src/components/spaces/NewSpaceDialog.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewSpaceDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        setOpen(false);
        setName("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New Space</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Space</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="space-name">Name</Label>
            <Input
              id="space-name" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="e.g. Acme Corp"
            />
          </div>
          <Button disabled={busy || !name.trim()} onClick={create} className="w-full">
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire the New Space action into the Spaces page header**

In `portal/src/app/app/spaces/page.tsx`: import `NewSpaceDialog` and pass it as the `PageHeader` action:

```tsx
import { NewSpaceDialog } from "@/components/spaces/NewSpaceDialog";
// ...
<PageHeader title="Spaces" subtitle="Your work, organized into threads." action={<NewSpaceDialog />} />
```

- [ ] **Step 4: Verify + commit**

Run: `cd portal && npx tsc --noEmit && npm run build`
Expected: tsc clean; build ok.
Browser check: "New Space" opens a dialog; creating adds a card (router.refresh). Verify `Dialog` primitive exists at `portal/src/components/ui/dialog.tsx` (it does) and exports `Dialog/DialogTrigger/DialogContent/DialogHeader/DialogTitle`; if a named export differs, adjust the import to match.

```bash
cd /Users/aniquesabir/projects/stewardai
git add portal/src/app/api/spaces/route.ts portal/src/components/spaces/NewSpaceDialog.tsx portal/src/app/app/spaces/page.tsx
git commit -m "feat(spaces): create-space route + New Space dialog"
```

---

### Task 7: Show + correct a meeting's Space on the meeting detail page

**Files:**
- Create: `portal/src/components/spaces/MeetingSpaceSection.tsx`
- Modify: `portal/src/app/app/meetings/[id]/page.tsx` (fetch space/tags/entities + render the section)

**Interfaces:**
- Consumes: `FileMeetingControl` (Task 5), `SpaceEntities`+`SpaceEntity` (Task 3), `Badge`, `Card`.
- Produces: nothing later depends on.

- [ ] **Step 1: Add the MeetingSpaceSection component**

```tsx
// portal/src/components/spaces/MeetingSpaceSection.tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FileMeetingControl, type SpaceOption } from "@/components/spaces/FileMeetingControl";
import { SpaceEntities, type SpaceEntity } from "@/components/spaces/SpaceEntities";

export function MeetingSpaceSection({
  meetingId,
  space,
  spaceSource,
  tags,
  entities,
  allSpaces,
}: {
  meetingId: string;
  space: { id: string; name: string } | null;
  spaceSource: string | null;
  tags: string[];
  entities: SpaceEntity[];
  allSpaces: SpaceOption[];
}) {
  const unconfirmed = !space || spaceSource === "suggested" || spaceSource === "unfiled";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Space</h2>
          {space ? (
            <Link href={`/app/spaces/${space.id}`} className="text-sm hover:underline">{space.name}</Link>
          ) : (
            <p className="text-sm text-muted-foreground">Unfiled</p>
          )}
        </div>
        <FileMeetingControl
          meetingId={meetingId}
          spaces={allSpaces}
          suggestedSpaceId={unconfirmed && space ? space.id : null}
          suggestedSpaceName={unconfirmed && space ? space.name : null}
        />
      </div>
      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {tags.map((t) => <Badge key={t} variant="outline">#{t}</Badge>)}
        </div>
      ) : null}
      {entities.length > 0 ? <div className="mt-3"><SpaceEntities entities={entities} /></div> : null}
    </Card>
  );
}
```

- [ ] **Step 2: Fetch space/tags/entities + all-spaces in the meeting detail page**

In `portal/src/app/app/meetings/[id]/page.tsx`, add these to the existing `Promise.all` (after the `profiles` query):

```tsx
      db.from("meeting_tags").select("tag").eq("meeting_id", params.id).eq("user_id", user.id),
      db.from("meeting_entities").select("entities(id,kind,name,email)").eq("meeting_id", params.id).eq("user_id", user.id),
      db.from("spaces").select("id,name").eq("user_id", user.id).eq("status", "active").order("name"),
```

Destructure them alongside the existing results, e.g.:
`const [{ data: segments }, { data: summary }, { data: actionItems }, { data: agentActions }, { data: profile }, { data: tagRows }, { data: entLinks }, { data: allSpaces }] = await Promise.all([ ... ]);`

Then resolve the meeting's own space + entities (the `meetings` row from `select("*")` already has `space_id`/`space_source`):

```tsx
  let meetingSpace: { id: string; name: string } | null = null;
  if (meeting.space_id) {
    const { data: sp } = await db.from("spaces").select("id,name").eq("id", meeting.space_id).eq("user_id", user.id).maybeSingle();
    meetingSpace = sp ?? null;
  }
  const meetingTags = (tagRows ?? []).map((t) => t.tag as string);
  const meetingEntities = (entLinks ?? [])
    .map((row) => (row as unknown as { entities: import("@/components/spaces/SpaceEntities").SpaceEntity | null }).entities)
    .filter((e): e is import("@/components/spaces/SpaceEntities").SpaceEntity => !!e);
```

Render `<MeetingSpaceSection ... />` near the top of the left column (import it), passing `meetingId={params.id}`, `space={meetingSpace}`, `spaceSource={meeting.space_source}`, `tags={meetingTags}`, `entities={meetingEntities}`, `allSpaces={(allSpaces ?? []) as {id:string;name:string}[]}`.

- [ ] **Step 3: Verify + commit**

Run: `cd portal && npx tsc --noEmit && npm run build`
Expected: tsc clean; build ok.
Browser check: a meeting detail shows its Space (or "Unfiled") with tags + people/companies, and a control to confirm the suggestion or move it to another space (which refreshes).

```bash
cd /Users/aniquesabir/projects/stewardai
git add portal/src/components/spaces/MeetingSpaceSection.tsx "portal/src/app/app/meetings/[id]/page.tsx"
git commit -m "feat(spaces): show + correct a meeting's Space on the detail page"
```

---

## Notes for the implementer

- **Supabase joined selects** (`meeting_entities.select("entities(...)")`) return the joined row under the FK-named key; typing is loose, so the plan casts via `as unknown as { entities: T | null }`. Keep that cast; don't fight the generated types.
- **`.not("space_id", "is", null)` / `.is("superseded_by", null)` / `.in(col, [...])`** are all supported by `@supabase/postgrest-js` (used elsewhere in the repo). If `.not(...)` gives trouble, `.filter("space_id", "not.is", null)` is the fallback.
- **Migration 0009 must be applied** to the dev DB for the browser checks to work (per repo convention, applying migrations is a manual `supabase db push` step). Unit tests + tsc + build do NOT need the DB.
- **No `select.tsx` primitive** exists — `FileMeetingControl` uses a native `<select>` (styled with tailwind). That's intentional; don't add a Radix Select for A2.
- A2 is portal-only; it does not touch the Python agent or `main`. Deploying the portal (Vercel) is separate.
- Deferred to a later slice: rename/archive Space UI (the PATCH route), tag editing, cross-Space entity history page, and the L3 living brief.
