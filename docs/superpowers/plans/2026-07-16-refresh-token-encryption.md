# Google Refresh-Token Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the Google OAuth `refresh_token` with an app-held key before it is stored in Supabase, so a database leak alone cannot use the token.

**Architecture:** A small server-only crypto module (`portal/src/lib/crypto/secrets.ts`) does AES-256-GCM encrypt/decrypt using a 32-byte key from the `SECRET_ENCRYPTION_KEY` host env var. The one write site (auth callback) encrypts on store; the three read sites are routed through a single `getCalendarRefreshToken` accessor that decrypts. Existing rows are truncated (users re-connect).

**Tech Stack:** Next.js (App Router), TypeScript, Node `node:crypto` (no new dependency), Jest + ts-jest, Supabase.

## Global Constraints

- **No new dependencies** — use Node's built-in `node:crypto` only.
- **Algorithm:** AES-256-GCM. Random 12-byte IV per encryption; 16-byte GCM auth tag.
- **Ciphertext format:** `v1:` + base64(`iv ‖ authTag ‖ ciphertext`). Version prefix is mandatory and checked on decrypt.
- **Key:** `SECRET_ENCRYPTION_KEY`, base64-encoded, must decode to exactly 32 bytes. Read at call time.
- **Fail-closed:** if the key is missing/wrong length, encrypt AND decrypt throw — never silently store or return plaintext.
- **Server-only:** `secrets.ts` must never be imported from a client component (same convention as `portal/src/lib/supabase/service.ts`).
- All paths below are relative to the repo root. The portal lives under `portal/`.
- Run all commands from the `portal/` directory.

---

### Task 1: Crypto module (`secrets.ts`) with unit tests

**Files:**
- Create: `portal/src/lib/crypto/secrets.ts`
- Test: `portal/src/lib/crypto/__tests__/secrets.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `encryptSecret(plaintext: string): string` — returns a `v1:`-prefixed token.
  - `decryptSecret(payload: string): string` — inverse of `encryptSecret`; throws on bad key / bad format / tampered payload.

- [ ] **Step 1: Write the failing tests**

Create `portal/src/lib/crypto/__tests__/secrets.test.ts`:

```ts
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";

// Deterministic 32-byte key for tests.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

describe("secrets (AES-256-GCM)", () => {
  const original = process.env.SECRET_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = original;
  });

  it("round-trips a value", () => {
    const token = "1//0abcDEF_refresh-token-example";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("produces a v1-prefixed payload that is not the plaintext", () => {
    const out = encryptSecret("secret");
    expect(out.startsWith("v1:")).toBe(true);
    expect(out).not.toContain("secret");
  });

  it("uses a fresh IV so two encryptions differ", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("throws when the payload was tampered with", () => {
    const out = encryptSecret("secret");
    // Flip the last base64 char.
    const flipped = out.slice(0, -1) + (out.endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(flipped)).toThrow();
  });

  it("throws when decrypting with a different key", () => {
    const out = encryptSecret("secret");
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptSecret(out)).toThrow();
  });

  it("throws on an unknown version prefix", () => {
    expect(() => decryptSecret("v2:AAAA")).toThrow(/format/i);
  });

  it("throws when the key is missing", () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    expect(() => encryptSecret("secret")).toThrow(/SECRET_ENCRYPTION_KEY/);
  });

  it("throws when the key is the wrong length", () => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptSecret("secret")).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- secrets`
Expected: FAIL — cannot find module `@/lib/crypto/secrets`.

- [ ] **Step 3: Write the implementation**

Create `portal/src/lib/crypto/secrets.ts`:

```ts
// Server-only. Never import in client components.
// AES-256-GCM encryption for at-rest secrets (e.g. Google refresh tokens).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("SECRET_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRET_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]);
  return `${VERSION}:${packed.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const sep = payload.indexOf(":");
  const version = sep === -1 ? "" : payload.slice(0, sep);
  if (version !== VERSION) {
    throw new Error(`Unsupported secret format: ${version || "(none)"}`);
  }
  const packed = Buffer.from(payload.slice(sep + 1), "base64");
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- secrets`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/crypto/secrets.ts portal/src/lib/crypto/__tests__/secrets.test.ts
git commit -m "feat(portal): add AES-256-GCM secret encryption module"
```

---

### Task 2: `getCalendarRefreshToken` accessor with test

**Files:**
- Modify: `portal/src/lib/calendar.ts` (add accessor + import)
- Test: `portal/src/lib/__tests__/calendar.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `decryptSecret` from Task 1.
- Produces:
  - `getCalendarRefreshToken(client: SupabaseClient, userId: string): Promise<string | null>` — reads the user's `calendar_connections` row and returns the **decrypted** refresh token, or `null` if no connection row exists.

- [ ] **Step 1: Write the failing test**

Append to `portal/src/lib/__tests__/calendar.test.ts`:

```ts
import { getCalendarRefreshToken } from "@/lib/calendar";
import { encryptSecret } from "@/lib/crypto/secrets";

describe("getCalendarRefreshToken", () => {
  const original = process.env.SECRET_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = original;
  });

  // Minimal stub matching the chained calls the accessor makes.
  function stubClient(row: { google_refresh_token: string } | null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof getCalendarRefreshToken>[0];
  }

  it("returns the decrypted token when a connection exists", async () => {
    const stored = encryptSecret("refresh-abc");
    const client = stubClient({ google_refresh_token: stored });
    expect(await getCalendarRefreshToken(client, "user-1")).toBe("refresh-abc");
  });

  it("returns null when there is no connection row", async () => {
    const client = stubClient(null);
    expect(await getCalendarRefreshToken(client, "user-1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- calendar`
Expected: FAIL — `getCalendarRefreshToken` is not exported.

- [ ] **Step 3: Add the accessor**

At the top of `portal/src/lib/calendar.ts`, add to the imports:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto/secrets";
```

Add this exported function to `portal/src/lib/calendar.ts` (e.g. after `buildMeetingUpsert`):

```ts
// Reads the user's calendar connection and returns the decrypted Google
// refresh token, or null if no connection exists. Single place that
// decrypts the token so the crypto stays out of page/route bodies.
export async function getCalendarRefreshToken(
  client: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: conn } = await client
    .from("calendar_connections")
    .select("google_refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn?.google_refresh_token) return null;
  return decryptSecret(conn.google_refresh_token);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- calendar`
Expected: PASS (existing `buildMeetingUpsert` tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/calendar.ts portal/src/lib/__tests__/calendar.test.ts
git commit -m "feat(portal): add getCalendarRefreshToken accessor (decrypts token)"
```

---

### Task 3: Encrypt on write (auth callback)

**Files:**
- Modify: `portal/src/app/auth/callback/route.ts` (~line 59)

**Interfaces:**
- Consumes: `encryptSecret` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Add the import**

At the top of `portal/src/app/auth/callback/route.ts`, add:

```ts
import { encryptSecret } from "@/lib/crypto/secrets";
```

- [ ] **Step 2: Encrypt the token in the upsert**

In the `service.from("calendar_connections").upsert(...)` call, change the token line. `refreshToken` is guaranteed non-null here because the enclosing `if (calendarConnected)` requires `Boolean(refreshToken)`.

Change:

```ts
        google_refresh_token: refreshToken,
```

to:

```ts
        google_refresh_token: encryptSecret(refreshToken as string),
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds (no type errors).

- [ ] **Step 4: Commit**

```bash
git add portal/src/app/auth/callback/route.ts
git commit -m "feat(portal): encrypt Google refresh token before storing"
```

---

### Task 4: Decrypt on read (route the 3 read sites through the accessor)

**Files:**
- Modify: `portal/src/app/api/calendar/sync/route.ts` (~lines 10-20)
- Modify: `portal/src/app/app/page.tsx` (~lines 24-64)
- Modify: `portal/src/app/app/meetings/page.tsx` (~lines 37-90)

**Interfaces:**
- Consumes: `getCalendarRefreshToken` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Update the sync route**

In `portal/src/app/api/calendar/sync/route.ts`, add to the imports:

```ts
import { fetchUpcomingEvents, buildMeetingUpsert, getCalendarRefreshToken } from "@/lib/calendar";
```

(Merge with the existing `@/lib/calendar` import — do not duplicate it.)

Replace the connection read + guard:

```ts
  const db = createServerClient(); // RLS-scoped read
  const { data: conn } = await db
    .from("calendar_connections")
    .select("google_refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!conn) return NextResponse.json({ error: "No calendar connected" }, { status: 400 });

  const events = await fetchUpcomingEvents(conn.google_refresh_token);
```

with:

```ts
  const db = createServerClient(); // RLS-scoped read
  const refreshToken = await getCalendarRefreshToken(db, user.id);

  if (!refreshToken) return NextResponse.json({ error: "No calendar connected" }, { status: 400 });

  const events = await fetchUpcomingEvents(refreshToken);
```

- [ ] **Step 2: Update `app/page.tsx`**

In `portal/src/app/app/page.tsx`, add the import:

```ts
import { getCalendarRefreshToken } from "@/lib/calendar";
```

Replace the connection read:

```ts
  const { data: conn } = await db
    .from("calendar_connections")
    .select("id,google_refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!conn) {
```

with:

```ts
  const refreshToken = await getCalendarRefreshToken(db, user.id);

  if (!refreshToken) {
```

Then replace the sync trigger block:

```ts
  if (conn.google_refresh_token) {
    const { syncUserMeetings } = await import("@/lib/meetings/sync");
    const service = createServiceClient(); // elevated: upsert may run without request cookies in the async tail
    syncUserMeetings(service, user.id, conn.google_refresh_token).catch(() => {});
  }
```

with:

```ts
  {
    const { syncUserMeetings } = await import("@/lib/meetings/sync");
    const service = createServiceClient(); // elevated: upsert may run without request cookies in the async tail
    syncUserMeetings(service, user.id, refreshToken).catch(() => {});
  }
```

- [ ] **Step 3: Update `meetings/page.tsx`**

In `portal/src/app/app/meetings/page.tsx`, add the import:

```ts
import { getCalendarRefreshToken } from "@/lib/calendar";
```

Replace the connection read:

```ts
  const { data: conn } = await db
    .from("calendar_connections")
    .select("id,google_refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!conn) {
```

with:

```ts
  const refreshToken = await getCalendarRefreshToken(db, user.id);

  if (!refreshToken) {
```

Then replace the sync trigger block:

```ts
  if (conn.google_refresh_token) {
    const { syncUserMeetings } = await import("@/lib/meetings/sync");
    const service = createServiceClient(); // elevated: upsert may run without request cookies in the async tail
    syncUserMeetings(service, user.id, conn.google_refresh_token).catch(() => {});
  }
```

with:

```ts
  {
    const { syncUserMeetings } = await import("@/lib/meetings/sync");
    const service = createServiceClient(); // elevated: upsert may run without request cookies in the async tail
    syncUserMeetings(service, user.id, refreshToken).catch(() => {});
  }
```

- [ ] **Step 4: Typecheck + run full test suite**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/api/calendar/sync/route.ts portal/src/app/app/page.tsx portal/src/app/app/meetings/page.tsx
git commit -m "feat(portal): decrypt refresh token via getCalendarRefreshToken at read sites"
```

---

### Task 5: Migration, env, and docs

**Files:**
- Create: `portal/supabase/migrations/0020_clear_calendar_connections.sql`
- Modify: `portal/.env.example`
- Modify: `.env.example` (repo root — if it documents portal secrets; otherwise skip)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the wipe migration**

Create `portal/supabase/migrations/0020_clear_calendar_connections.sql`:

```sql
-- Refresh tokens move from plaintext to app-layer AES-256-GCM
-- (see docs/superpowers/specs/2026-07-16-refresh-token-encryption-design.md).
-- No production data is worth preserving; clear existing rows so no legacy
-- plaintext token survives. Users re-connect their calendar (writes are
-- encrypted from here on).
truncate table public.calendar_connections;
```

- [ ] **Step 2: Document the env var**

In `portal/.env.example`, add (near other secrets):

```
# 32-byte key (base64) for encrypting stored secrets (Google refresh tokens).
# Generate: openssl rand -base64 32
# Set in the host secret store (e.g. Vercel env). Never commit a real value.
# Losing/changing this makes existing encrypted tokens unrecoverable -> users must re-connect.
SECRET_ENCRYPTION_KEY=<32-byte-base64>
```

- [ ] **Step 3: Apply the migration locally (verify SQL is valid)**

Run: `npx supabase db reset` (or the project's usual migration command)
Expected: migrations apply cleanly through `0020`.

If the local Supabase stack is not running, skip execution but confirm the SQL parses (no syntax error) by review.

- [ ] **Step 4: Commit**

```bash
git add portal/supabase/migrations/0020_clear_calendar_connections.sql portal/.env.example
git commit -m "chore(portal): wipe legacy plaintext tokens + document SECRET_ENCRYPTION_KEY"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Set a real key locally**

```bash
# in portal/.env.local
SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

- [ ] **Step 2: Connect a calendar via the app**

Run the portal, sign in, and complete the "Connect Google Calendar" flow (`/welcome` → `/auth/connect-calendar`).

- [ ] **Step 3: Confirm the stored token is ciphertext**

Query the DB:

```sql
select left(google_refresh_token, 3) as prefix from public.calendar_connections limit 1;
```

Expected: `prefix` is `v1:` (not a raw Google `1//...` token).

- [ ] **Step 4: Confirm read path works**

Load `/app` (or hit `/api/calendar/sync`) and confirm meetings sync succeeds — proving the token decrypts and calendar sync still works end-to-end.

---

## Notes for the implementer

- **Fail-closed is intentional.** If `SECRET_ENCRYPTION_KEY` is unset, the callback throws rather than storing plaintext — that's the desired behavior. Make sure the key is set in every environment before deploying Task 3.
- **Do not** import `secrets.ts` from any `"use client"` file.
- The `v1:` prefix is what lets a future KMS/rotation upgrade avoid a schema change — keep decrypt dispatching on it.
