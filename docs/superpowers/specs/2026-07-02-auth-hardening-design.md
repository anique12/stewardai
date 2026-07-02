# StewardAI Portal — Auth Hardening Design

**Date:** 2026-07-02
**Status:** Approved design → implementation
**Parent spec:** `2026-07-02-production-mvp-requirements.md` (§4 Authentication & Access Control, §5 auth-aware landing)
**Scope:** The `portal/` Next.js app only.

---

## 1. Goal

Make per-user data isolation *enforced by the database*, not merely by convention, and close the auth-awareness gaps identified in the MVP spec — without expanding into the other MVP areas (meeting UI, apps directory, deploy). This is the "fastest trust win" slice from the parent spec's suggested execution order.

## 2. Current state (audit findings)

**Working today:**
- Page guards: `middleware.ts` redirects unauthenticated `/app/*` → `/?login=1`; `app/app/layout.tsx` independently re-checks `getUser()` and redirects. (Defense in depth.)
- API guards: every API route under `app/api/*` calls `supabase.auth.getUser()` and returns `401` before doing work.
- Meeting-detail IDOR is closed: the meeting is fetched scoped by `user_id` and `notFound()` fires *before* any child-table fetch.
- RLS policies exist for `profiles`, `calendar_connections`, `meetings`, `transcript_segments`, `summaries`, `action_items` (migration `0002`), plus `connected_apps` (`0003`) and `agent_actions` (`0004`).
- Sign-out exists (`app/app/settings/page.tsx`).

**Gaps this design addresses:**

1. **RLS is a dead backstop.** Every page and API route uses `createServiceClient()` (service-role key), which *bypasses RLS entirely*. Isolation depends 100% on each query remembering `.eq("user_id", user.id)`. One forgotten filter leaks cross-user data and RLS will not catch it.
2. **Landing page is not auth-aware (§5).** `app/page.tsx` is a static server component with no `getUser()`; a logged-in visitor still sees "Sign in" CTAs (`/auth/login`) instead of "Go to app". Nothing consumes the `?login=1` param the middleware sets.
3. **No systematic, verifiable guarantee** that every route + every service-client query is user-scoped. It is correct today by convention, which is fragile as routes are added.

**Explicitly NOT in this slice (flagged, not built):**
- §4.1 publishing the Google login consent screen (a Google Cloud console action, not portal code).
- Open-question #4: Composio managed vs. BYO OAuth → CASA (a Composio dashboard fact-check, not portal code).

## 3. Design

### A. Make RLS load-bearing for reads

`createServerClient()` (anon key + the user's auth cookies) already applies RLS. The fix is to route user-facing **reads** through it instead of the service client:

- **Meetings list** (`app/app/page.tsx`) — read `meetings` and `calendar_connections` via the RLS server client. The DB enforces `user_id = auth.uid()`; the explicit `.eq("user_id", user.id)` stays as belt-and-suspenders.
- **Meeting detail** (`app/app/meetings/[id]/page.tsx`) — read `meetings`, `transcript_segments`, `summaries`, `action_items`, `agent_actions` via the RLS server client. The join-based policies already cover the child tables, so a non-owner gets zero rows even without the code-level ownership check.
- **Integrations status** (read portion of `app/api/integrations/status/route.ts`) — read `connected_apps` via the RLS server client.

**Service client is retained only for writes that legitimately need elevation:** calendar-sync upserts into `meetings`, `connected_apps` upserts, agent-action approve/dismiss updates, instant-meeting inserts. These keep their explicit `user_id` filters *and* must satisfy RLS-equivalent scoping in code (documented in the audit checklist).

**Rule going forward:** reads of user-owned data use the RLS client; the service client is only for writes/elevated operations, and every service-client query must carry a `user_id` (or ownership-join) filter.

### B. Uniform guard helper

Add `requireUser()` to `src/lib/auth-helpers.ts`:
- Server-component variant: returns `user` or calls `redirect("/?login=1")`.
- Route-handler variant: returns `{ user }` or throws/returns a `401` response.

Refactor existing pages/routes to use it so the guard is one line and consistent. Behavior is unchanged; this removes copy-paste drift.

### C. Auth-aware landing (§5)

Make the landing CTAs reflect auth state. `app/page.tsx` becomes a server component that calls `getUser()` and passes an `isAuthed` flag to `LandingNav` and `Hero`:
- Logged in → primary CTA "Go to app" → `/app`.
- Logged out → existing "Sign in" / "Get started" → `/auth/login` (unchanged).

### D. Isolation test suite

Add tests (Jest, matching the existing `src/lib/__tests__` setup) proving:
- Unauthenticated request to each protected page redirects and to each API route returns `401`.
- A second user (User B) reading User A's meeting id via the RLS client gets zero rows / `notFound()`.
- Service-client write paths reject/ignore rows not owned by the caller.

Where full DB integration is impractical in unit tests, mock the Supabase client to assert the *correct client* (RLS vs service) and the presence of the `user_id` filter is used per call site.

### E. Audit checklist doc

A short `docs/` checklist mapping every route/page → guard used + read/write client + scoping filter, so the invariant is verifiable and new routes have a pattern to copy.

## 4. Testing strategy

- Unit/mock tests as in §3.D, run via `npm test` (Jest) in `portal/`.
- Manual verification: sign in as two accounts, confirm each sees only its own meetings; confirm logged-in landing shows "Go to app"; confirm sign-out returns to landing and `/app` then redirects.
- `next build` / lint must pass.

## 5. Risks & mitigations

- **RLS switch surfaces missing/incorrect policies** (e.g., a read that returns empty because a policy is stricter than expected). Mitigation: the test suite exercises the owner-reads-own-data path, catching over-strict policies before ship.
- **Behavioral change on landing** could affect SSR caching. Mitigation: mark `app/page.tsx` dynamic where needed; keep the change limited to CTA props.

## 6. Out of scope

Meeting Intelligence UI redesign, connected-apps directory, deployment/domain, consent-screen publishing, Composio auth-mode decision — each is its own slice of the parent MVP spec.
