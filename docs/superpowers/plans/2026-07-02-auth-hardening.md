# Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-user data isolation enforced by Supabase RLS (not just by convention), unify auth guards, and make the landing page auth-aware.

**Architecture:** Route user-facing *reads* through the RLS-scoped Supabase server client (anon key + user cookies) so the database enforces `user_id = auth.uid()`. Keep the service-role client only for writes/elevated operations, each retaining an explicit `user_id` filter. Add a `requireUser*` guard helper and refactor call sites to it. Make the landing CTAs reflect auth state via a server-read `getUser()`.

**Tech Stack:** Next.js 14 (App Router), `@supabase/ssr`, `@supabase/supabase-js`, TypeScript, Jest (`ts-jest`, node env), Tailwind.

## Global Constraints

- Work only inside `portal/`. Run all commands from `portal/`.
- Test runner: `npm test` (Jest, `ts-jest`, `testEnvironment: node`, alias `^@/(.*)$` → `src/$1`).
- The RLS-scoped read client is `createServerClient()` from `@/lib/supabase/server`. The elevated client is `createServiceClient()` from `@/lib/supabase/service`.
- Guard-helper redirect target for pages: `/?login=1` (matches existing `middleware.ts`). Route-handler unauthorized response: `NextResponse.json({ error: "Unauthorized" }, { status: 401 })` (matches existing routes).
- Do not remove the existing explicit `.eq("user_id", user.id)` filters when switching a query to the RLS client — keep them as belt-and-suspenders.
- Do not change RLS SQL policies; they already exist in `supabase/migrations/0002`–`0004`.
- Commit after each task.

---

### Task 1: `requireUser` guard helpers

**Files:**
- Modify: `portal/src/lib/auth-helpers.ts`
- Test: `portal/src/lib/__tests__/require-user.test.ts` (create)

**Interfaces:**
- Consumes: `createServerClient()` from `@/lib/supabase/server`; `redirect` from `next/navigation`; `NextResponse` from `next/server`; `User` type from `@supabase/supabase-js`.
- Produces:
  - `requireUserPage(): Promise<User>` — returns the user or calls `redirect("/?login=1")` (which throws, so callers can treat the return as always-present).
  - `requireUserRoute(): Promise<{ user: User } | { user: null; response: NextResponse }>` — returns `{ user }` when authed, or `{ user: null, response }` with a 401 when not.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/__tests__/require-user.test.ts`:

```ts
import type { User } from "@supabase/supabase-js";

const getUserMock = jest.fn();
const redirectMock = jest.fn(() => {
  throw new Error("REDIRECT");
});

jest.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ auth: { getUser: getUserMock } }),
}));

import { requireUserPage, requireUserRoute } from "@/lib/auth-helpers";

const fakeUser = { id: "user-a" } as unknown as User;

beforeEach(() => {
  getUserMock.mockReset();
  redirectMock.mockClear();
});

describe("requireUserPage", () => {
  it("returns the user when authenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: fakeUser } });
    await expect(requireUserPage()).resolves.toEqual(fakeUser);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /?login=1 when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    await expect(requireUserPage()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/?login=1");
  });
});

describe("requireUserRoute", () => {
  it("returns { user } when authenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: fakeUser } });
    const result = await requireUserRoute();
    expect(result.user).toEqual(fakeUser);
  });

  it("returns a 401 response when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const result = await requireUserRoute();
    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx jest require-user -t "" 2>&1 | tail -20` (or `npm test -- require-user`)
Expected: FAIL — `requireUserPage`/`requireUserRoute` are not exported from `auth-helpers`.

- [ ] **Step 3: Write minimal implementation**

Append to `portal/src/lib/auth-helpers.ts` (keep the existing `extractRefreshToken`):

```ts
import type { Session, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// (existing extractRefreshToken stays above/below — do not remove it)

/** Server-component guard. Returns the user, or redirects to the login surface. */
export async function requireUserPage(): Promise<User> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/?login=1");
  return user;
}

/** Route-handler guard. Returns { user } or { user: null, response } with a 401. */
export async function requireUserRoute(): Promise<
  { user: User; response?: undefined } | { user: null; response: NextResponse }
> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user };
}
```

Note: the existing `import type { Session }` line already imports from `@supabase/supabase-js`; merge `User` into that import rather than duplicating.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal && npm test -- require-user`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/auth-helpers.ts portal/src/lib/__tests__/require-user.test.ts
git commit -m "feat(auth): add requireUserPage/requireUserRoute guard helpers"
```

---

### Task 2: Route meetings-list reads through RLS client

**Files:**
- Modify: `portal/src/app/app/page.tsx`

**Interfaces:**
- Consumes: `requireUserPage()` (Task 1); `createServerClient()` (RLS reads); `createServiceClient()` (retained for the calendar-sync upsert only).
- Produces: no new exports.

**Change summary:** Use `requireUserPage()` for the guard. Use the RLS client (`createServerClient()`) for all `select` reads (`calendar_connections`, `meetings`). Keep `createServiceClient()` ONLY for the fire-and-forget `meetings` upsert inside the sync block (line ~53) and the `google_refresh_token` read stays via service because the refresh token column is only readable with elevation (verify: it is on `calendar_connections`, which has RLS select for the owner — so it CAN move to the RLS client too; move it).

- [ ] **Step 1: Apply the edit**

In `portal/src/app/app/page.tsx`:

Replace the top of the component:

```tsx
import { InstantJoin } from "@/components/meetings/InstantJoin";
import { MeetingRow } from "@/components/meetings/MeetingRow";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const user = await requireUserPage();
  const db = createServerClient(); // RLS-scoped reads

  // Check calendar connection
  const { data: conn } = await db
    .from("calendar_connections")
    .select("id")
    .eq("user_id", user.id)
    .single();
```

Then, in the sync block, read the refresh token via the RLS client but keep the upsert on the service client:

```tsx
  // Trigger calendar sync inline (fire-and-forget)
  const { buildMeetingUpsert, fetchUpcomingEvents } = await import("@/lib/calendar");
  const { data: calConn } = await db
    .from("calendar_connections")
    .select("google_refresh_token")
    .eq("user_id", user.id)
    .single();
  if (calConn) {
    const service = createServiceClient(); // elevated: upsert may run without request cookies in the async tail
    fetchUpcomingEvents(calConn.google_refresh_token)
      .then((events) => {
        const rows = events.map((e) => buildMeetingUpsert(user.id, e));
        if (rows.length > 0) {
          service
            .from("meetings")
            .upsert(rows, { onConflict: "user_id,google_event_id", ignoreDuplicates: false })
            .then(() => {});
        }
      })
      .catch(() => {});
  }
```

Then switch the `upcoming` and `past` reads to `db`:

```tsx
  const now = new Date().toISOString();
  const { data: upcoming } = await db
    .from("meetings")
    .select("id,title,start_time,meet_url,opted_in,bot_status")
    .eq("user_id", user.id)
    .gte("start_time", now)
    .order("start_time");

  const { data: past } = await db
    .from("meetings")
    .select("id,title,start_time,meet_url,opted_in,bot_status")
    .eq("user_id", user.id)
    .lt("start_time", now)
    .eq("bot_status", "done")
    .order("start_time", { ascending: false })
    .limit(20);
```

Leave the JSX return unchanged.

- [ ] **Step 2: Typecheck / build the page**

Run: `cd portal && npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add portal/src/app/app/page.tsx
git commit -m "refactor(auth): meetings list reads via RLS client; guard via requireUserPage"
```

---

### Task 3: Route meeting-detail reads through RLS client

**Files:**
- Modify: `portal/src/app/app/meetings/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireUserPage()` (Task 1); `createServerClient()` (RLS reads).
- Produces: no new exports.

**Change summary:** With RLS, a non-owner gets zero rows for the meeting and all child tables (join-based policies in `0002`). The explicit `.eq("user_id", user.id)` on `meetings` stays; the `notFound()` guard stays. The `agent_actions` read keeps its `.eq("user_id", user.id)` too. Drop the service client entirely from this file.

- [ ] **Step 1: Apply the edit**

Replace lines 6–7 imports and the component head/data-fetch:

```tsx
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUserPage();
  const db = createServerClient(); // RLS-scoped reads

  const { data: meeting } = await db
    .from("meetings")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!meeting) notFound();

  const [{ data: segments }, { data: summary }, { data: actionItems }, { data: agentActions }] = await Promise.all([
    db.from("transcript_segments").select("*").eq("meeting_id", params.id).order("seq"),
    db.from("summaries").select("*").eq("meeting_id", params.id).single(),
    db.from("action_items").select("*").eq("meeting_id", params.id).order("created_at"),
    db.from("agent_actions").select("*").eq("meeting_id", params.id).eq("user_id", user.id).order("created_at"),
  ]);
```

Remove the now-unused `import { createServiceClient } ...` line. Leave everything below the data fetch unchanged.

- [ ] **Step 2: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: no new type errors (and no "unused import" if lint runs).

- [ ] **Step 3: Commit**

```bash
git add "portal/src/app/app/meetings/[id]/page.tsx"
git commit -m "refactor(auth): meeting detail reads via RLS client"
```

---

### Task 4: Guard + RLS read for integrations status route

**Files:**
- Modify: `portal/src/app/api/integrations/status/route.ts`

**Interfaces:**
- Consumes: `requireUserRoute()` (Task 1); `createServerClient()` for the final read of `connected_apps`; `createServiceClient()` retained ONLY for the reconcile `upsert`.
- Produces: no new exports.

**Change summary:** Replace the inline `getUser()`/401 with `requireUserRoute()`. The Composio reconcile `upsert` stays on the service client (it writes rows to match Composio's truth). Both `select` reads of `connected_apps` (the error-fallback read at ~line 59 and the final read at ~line 86) move to the RLS client.

- [ ] **Step 1: Apply the edit**

Replace the imports and the guard block:

```ts
import { requireUserRoute } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getComposio, SUPPORTED_TOOLKITS } from "@/lib/composio";
import { NextResponse } from "next/server";

// localStatus(...) unchanged

export async function GET() {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const db = createServerClient();     // RLS-scoped reads
  const service = createServiceClient(); // elevated: reconcile upsert
```

Change the error-fallback read (was `service.from("connected_apps").select(...)`):

```ts
    const { data: existing } = await db
      .from("connected_apps")
      .select("app,status,connected_account_id,connected_at,updated_at")
      .eq("user_id", user.id);
    return NextResponse.json({ apps: existing ?? [] });
```

Keep the reconcile upsert on `service`:

```ts
  await service
    .from("connected_apps")
    .upsert(upserts, { onConflict: "user_id,app" });
```

Change the final read to `db`:

```ts
  const { data: rows } = await db
    .from("connected_apps")
    .select("app,status,connected_account_id,connected_at,updated_at")
    .eq("user_id", user.id);

  return NextResponse.json({ apps: rows ?? [] });
```

- [ ] **Step 2: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add portal/src/app/api/integrations/status/route.ts
git commit -m "refactor(auth): integrations status reads via RLS client; guard via requireUserRoute"
```

---

### Task 5: Auth-aware landing CTAs

**Files:**
- Create: `portal/src/lib/landing-cta.ts`
- Test: `portal/src/lib/__tests__/landing-cta.test.ts`
- Modify: `portal/src/app/page.tsx`, `portal/src/components/landing/Nav.tsx`, `portal/src/components/landing/Hero.tsx`

**Interfaces:**
- Consumes: `createServerClient()` in `page.tsx` for `getUser()`.
- Produces:
  - `landingCta(isAuthed: boolean): { href: string; primaryLabel: string; secondaryLabel: string | null }`
  - `LandingNav` and `Hero` gain an optional prop `isAuthed?: boolean` (default `false`).

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/__tests__/landing-cta.test.ts`:

```ts
import { landingCta } from "@/lib/landing-cta";

describe("landingCta", () => {
  it("points logged-in users to the app", () => {
    expect(landingCta(true)).toEqual({
      href: "/app",
      primaryLabel: "Go to app",
      secondaryLabel: null,
    });
  });

  it("points logged-out users to sign in", () => {
    expect(landingCta(false)).toEqual({
      href: "/auth/login",
      primaryLabel: "Start free",
      secondaryLabel: "Sign in",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npm test -- landing-cta`
Expected: FAIL — module `@/lib/landing-cta` not found.

- [ ] **Step 3: Implement the helper**

Create `portal/src/lib/landing-cta.ts`:

```ts
export function landingCta(isAuthed: boolean): {
  href: string;
  primaryLabel: string;
  secondaryLabel: string | null;
} {
  if (isAuthed) {
    return { href: "/app", primaryLabel: "Go to app", secondaryLabel: null };
  }
  return { href: "/auth/login", primaryLabel: "Start free", secondaryLabel: "Sign in" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal && npm test -- landing-cta`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the helper into the landing page (server read)**

In `portal/src/app/page.tsx`, make the component async and read auth state, passing it to Nav + Hero:

```tsx
import { LandingNav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
// ...existing imports unchanged...
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthed = !!user;

  return (
    <>
      <LandingNav isAuthed={isAuthed} />
      <main>
        <Hero isAuthed={isAuthed} />
        {/* ...rest of the sections unchanged... */}
```

Leave all other sections exactly as they are.

- [ ] **Step 6: Make `Hero` honor the prop**

In `portal/src/components/landing/Hero.tsx`:

```tsx
import { landingCta } from "@/lib/landing-cta";

export function Hero({ isAuthed = false }: { isAuthed?: boolean }) {
  const cta = landingCta(isAuthed);
  // ...
```

Replace the primary CTA `<Link href="/auth/login" ...>Start free ...</Link>` with:

```tsx
            <Link
              href={cta.href}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {cta.primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
```

- [ ] **Step 7: Make `Nav` honor the prop**

In `portal/src/components/landing/Nav.tsx` change the signature (it is a client component — the boolean prop passes fine from the server parent):

```tsx
export function LandingNav({ isAuthed = false }: { isAuthed?: boolean }) {
```

Add near the top of the component body:

```tsx
  const cta = landingCta(isAuthed);
```

and import it:

```tsx
import { landingCta } from "@/lib/landing-cta";
```

In the **Desktop CTAs** block: render the "Sign in" link only when `cta.secondaryLabel` is set, and make the primary button use `cta`:

```tsx
          <div className="hidden items-center gap-2 lg:flex">
            {cta.secondaryLabel ? (
              <Link
                href="/auth/login"
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {cta.secondaryLabel}
              </Link>
            ) : null}
            <Link
              href={cta.href}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              {cta.primaryLabel}
            </Link>
          </div>
```

Apply the same pattern to the **Mobile panel** CTA block (conditional secondary "Sign in", primary uses `cta.href` / `cta.primaryLabel`).

- [ ] **Step 8: Typecheck + run all tests**

Run: `cd portal && npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add portal/src/lib/landing-cta.ts portal/src/lib/__tests__/landing-cta.test.ts portal/src/app/page.tsx portal/src/components/landing/Nav.tsx portal/src/components/landing/Hero.tsx
git commit -m "feat(landing): auth-aware CTAs (Go to app when signed in)"
```

---

### Task 6: Apply `requireUserRoute` to remaining API routes

**Files:**
- Modify: `portal/src/app/api/calendar/sync/route.ts`
- Modify: `portal/src/app/api/integrations/[app]/connect/route.ts`
- Modify: `portal/src/app/api/integrations/[app]/disconnect/route.ts`
- Modify: `portal/src/app/api/meetings/instant/route.ts`
- Modify: `portal/src/app/api/meetings/[id]/actions/[actionId]/approve/route.ts`
- Modify: `portal/src/app/api/meetings/[id]/actions/[actionId]/dismiss/route.ts`

**Interfaces:**
- Consumes: `requireUserRoute()` (Task 1).
- Produces: no new exports.

**Change summary:** In each route, replace the inline `const supabase = createServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });` with:

```ts
const { user, response } = await requireUserRoute();
if (!user) return response;
```

Remove the now-unused `createServerClient` import from each route if it is no longer referenced. **Do NOT** change these routes' write clients — they legitimately use `createServiceClient()` and keep their `user_id` scoping/ownership checks. This is a guard-uniformity refactor with no behavior change.

- [ ] **Step 1: Edit each route** as described above (one file at a time). For routes that reference `createServerClient` elsewhere, keep the import.

- [ ] **Step 2: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: no new type errors, no unused-import errors.

- [ ] **Step 3: Manual smoke — unauthenticated 401**

Run (dev server in another shell: `cd portal && npm run dev`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/integrations/status
```
Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add portal/src/app/api
git commit -m "refactor(auth): unify API route guards on requireUserRoute"
```

---

### Task 7: Audit checklist doc + manual isolation verification

**Files:**
- Create: `portal/docs/auth-audit.md`

**Interfaces:** none (documentation).

**Change summary:** A table mapping every page/route → guard used, read client (RLS vs service), and scoping filter, so the invariant is verifiable and new routes have a pattern to copy. Includes the manual two-account RLS verification steps (the true isolation test — no DB integration harness exists in this repo, so this is verified manually rather than with fabricated unit tests).

- [ ] **Step 1: Write the doc**

Create `portal/docs/auth-audit.md`:

```markdown
# Portal Auth & Isolation Audit

**Invariant:** user-owned *reads* use the RLS client (`createServerClient`); the
service client (`createServiceClient`) is only for writes/elevated ops and every
such query carries a `user_id` (or ownership-join) filter.

## Pages
| Page | Guard | Read client | Scoping |
|------|-------|-------------|---------|
| `app/app/layout.tsx` | inline `getUser()` → redirect | — | — |
| `app/app/page.tsx` | `requireUserPage` | RLS | `user_id` + RLS |
| `app/app/meetings/[id]/page.tsx` | `requireUserPage` | RLS | `user_id` + RLS join policies |
| `app/page.tsx` (landing) | none (public) | RLS (`getUser` for CTA) | n/a |

## API routes
| Route | Guard | Client(s) | Scoping |
|-------|-------|-----------|---------|
| `api/integrations/status` | `requireUserRoute` | RLS read + service upsert | `user_id` |
| `api/integrations/[app]/connect` | `requireUserRoute` | service | `user_id` |
| `api/integrations/[app]/disconnect` | `requireUserRoute` | service | `user_id` + ownership check |
| `api/calendar/sync` | `requireUserRoute` | service | `user_id` |
| `api/meetings/instant` | `requireUserRoute` | service | `user_id` |
| `api/meetings/[id]/actions/[actionId]/approve` | `requireUserRoute` | service | ownership check |
| `api/meetings/[id]/actions/[actionId]/dismiss` | `requireUserRoute` | service | ownership check |

## Manual isolation verification (run before ship)
1. Sign in as User A, note a meeting id from `/app`.
2. In a separate browser/profile, sign in as User B.
3. As User B, open `/app/meetings/<User A's id>` → expect **Not Found** (RLS returns zero rows).
4. As User B, `GET /api/integrations/status` → expect only User B's apps.
5. Sign out as User B → expect redirect to `/`; then visit `/app` → expect redirect to `/?login=1`.
6. On the landing page while signed in → primary CTA reads **"Go to app"** → `/app`.
```

- [ ] **Step 2: Perform the manual verification** in step 1's checklist against a running dev server and confirm each expectation. Fix any failures before committing (a failure here means an RLS policy is missing or a read still uses the service client).

- [ ] **Step 3: Commit**

```bash
git add portal/docs/auth-audit.md
git commit -m "docs(auth): route/read isolation audit + manual verification checklist"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full test + build**

Run: `cd portal && npm test && npm run build`
Expected: all Jest suites pass; `next build` completes with no errors.

- [ ] **Step 2: Confirm middleware still guards `/app`**

Run (dev server up): `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/app`
Expected: `307`/`308` redirect toward `/?login=1` (unauthenticated).

- [ ] **Step 3: Commit any build-fix deltas** (only if the build required changes).

```bash
git add -A && git commit -m "chore(auth): final verification fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (design §3):**
- §3.A make RLS load-bearing for reads → Tasks 2, 3, 4 (list, detail, status reads switched to RLS client). ✅
- §3.B uniform guard helper → Task 1 + applied in Tasks 2–6. ✅
- §3.C auth-aware landing → Task 5. ✅
- §3.D isolation tests → Task 1 (401 unit tests), Task 5 (CTA unit tests), Task 7 (manual two-account RLS verification — honest about the absence of a DB integration harness). ✅
- §3.E audit checklist doc → Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step shows real code and exact commands. ✅

**Type consistency:** `requireUserPage(): Promise<User>` and `requireUserRoute(): { user } | { user: null; response }` are used consistently in Tasks 2–6; `landingCta(isAuthed)` return shape matches its test and both consumers. ✅

**Note on scope honesty:** True cross-user "zero rows" enforcement is verified manually (Task 7) because the repo has no Supabase integration-test harness; adding one is out of scope for this slice. The RLS-client switch is what makes that manual test meaningful.
```
