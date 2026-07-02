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
| `api/calendar/sync` | `requireUserRoute` | RLS read + service upsert | `user_id` |
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
