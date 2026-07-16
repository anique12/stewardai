# StewardAI — Google Refresh-Token Encryption

**Date:** 2026-07-16
**Status:** Approved design → implementation plan next
**Scope:** Encrypt the Google OAuth `refresh_token` at the application layer before it is stored in Supabase.

---

## 1. Motivation

`calendar_connections.google_refresh_token` is currently a **plaintext** column. A refresh
token is a standing credential to a user's Google account (Calendar today; Gmail/Drive as
scopes grow), so it is the single highest-value secret we persist. Meanwhile the privacy/
trust pages already claim data is "encrypted at rest" — today that is only Supabase's
default disk encryption, which does nothing against a leaked DB dump or a stolen DB
credential.

This change encrypts the token with a key held **outside** the database, so that possession
of the database contents alone is not enough to use the token.

## 2. Threat model

**Defends against:**
- A leaked Supabase dump / backup file.
- SQL injection or a compromised read path that can `SELECT` from `calendar_connections`.
- A stolen/leaked database connection string or service-role key used directly against the DB.
- A curious DB-level or Supabase-side insider.

In all of these the attacker obtains ciphertext plus a per-value nonce and **no key** — the
key lives only in the portal host's secret store.

**Explicitly does NOT defend against:**
- A full compromise of the portal server process, which legitimately holds the key in order
  to use the token. Real defense there would require end-to-end encryption, which is
  incompatible with server-side calendar sync. This boundary is accepted.

## 3. Approach (decided)

Application-layer **AES-256-GCM** encryption performed in the Next.js portal (TypeScript /
Node), with the master key supplied via a **host environment secret** (e.g. Vercel
Environment Variables), stored separately from the database.

Rejected alternatives:
- **External KMS envelope encryption** — strongest, but adds a cloud dependency, IAM setup,
  and per-call latency/ops not warranted for the MVP. The ciphertext format below is
  versioned so this can be adopted later with no schema change.
- **Supabase Vault / pgsodium** — the key would live in the same Supabase project we are
  trying to protect from a DB-level compromise; weaker separation for our threat model.

## 4. The crypto module — `portal/src/lib/crypto/secrets.ts`

A small, server-only, reusable module. Built only for the refresh token now, but naturally
reusable for other stored secrets later (e.g. Composio account identifiers).

**Public interface:**

```ts
export function encryptSecret(plaintext: string): string
export function decryptSecret(payload: string): string
```

**Implementation details:**
- Uses Node's built-in `node:crypto` — no new dependency.
- **AES-256-GCM**, which provides confidentiality and tamper detection (the GCM auth tag) in
  one primitive.
- A fresh **random 12-byte IV** per encryption; IVs are never reused.
- **Ciphertext format:** `v1:` + `base64(iv ‖ authTag ‖ ciphertext)`.
  - The `iv` is 12 bytes, the `authTag` is 16 bytes; the remainder is the ciphertext.
  - The `v1:` version prefix lets `decryptSecret` dispatch on scheme, so a future KMS or
    key-rotation upgrade needs no schema change and no data migration.
- **Key handling:** the module reads `SECRET_ENCRYPTION_KEY` from the environment (32 bytes,
  base64-encoded). If the key is missing or not exactly 32 bytes, the module **throws on
  first use** — a misconfigured deploy fails loudly rather than silently storing plaintext.
- The file is marked server-only (same convention as `portal/src/lib/supabase/service.ts`)
  and must never be imported from a client component.

**Error behavior:**
- `encryptSecret` throws if the key is missing/invalid.
- `decryptSecret` throws on: missing/invalid key, unknown version prefix, malformed base64,
  or a failed GCM auth-tag check (tampered or wrong-key ciphertext).

## 5. Integration points

The token is handled entirely in the TypeScript portal — one write site and three read
sites (no Python code touches it).

**Write (1 site):**
- `portal/src/app/auth/callback/route.ts` (~line 59) — wrap the value in the upsert:
  `google_refresh_token: encryptSecret(refreshToken)`.

**Reads (3 sites), centralized:**
Rather than scatter `decryptSecret()` calls, add one accessor and route all reads through it:

```ts
// portal/src/lib/calendar.ts (or a small co-located helper)
export async function getCalendarRefreshToken(
  service: SupabaseServiceClient,
  userId: string,
): Promise<string | null>
```

It performs the `SELECT` of `google_refresh_token` and returns the decrypted token (or
`null` if no connection row exists). Replace the inline reads in:
- `portal/src/app/app/page.tsx` (~line 27)
- `portal/src/app/app/meetings/page.tsx` (~line 40)
- `portal/src/app/api/calendar/sync/route.ts` (~line 14)

Decryption logic then lives in exactly one function.

## 6. Data migration

No production data is worth preserving, and forcing a one-time calendar re-connect is
acceptable. A migration clears any legacy plaintext so nothing stale survives:

- `portal/supabase/migrations/0020_clear_calendar_connections.sql`:
  `truncate table public.calendar_connections;`

After deploy, users reconnect their calendar; the new row is written encrypted.

## 7. Configuration & docs

- Add to `portal/.env.example`:
  `SECRET_ENCRYPTION_KEY=<32-byte-base64>  # generate: openssl rand -base64 32`
- Document in the deploy notes that `SECRET_ENCRYPTION_KEY` must be set in the host secret
  store (e.g. Vercel env), never committed. Losing this key makes existing tokens
  undecryptable (users must re-connect) — treat it as a durable secret.

## 8. Testing

**Unit tests** for `secrets.ts`:
- Round-trip: `decryptSecret(encryptSecret(x)) === x` for representative token strings.
- Output carries the `v1:` prefix and is not equal to the plaintext.
- Two encryptions of the same input differ (random IV).
- A tampered payload (flip a byte) causes `decryptSecret` to throw (GCM auth tag).
- Decrypting with a different key throws.
- Missing / wrong-length `SECRET_ENCRYPTION_KEY` throws.
- Unknown version prefix throws.

**Integration check:**
- The auth callback stores a `v1:`-prefixed value in `calendar_connections`.
- `getCalendarRefreshToken` recovers the original token from that stored value.

## 9. Non-goals (out of scope)

- A key-rotation mechanism (the format is rotation-*ready*; rotation itself is not built).
- KMS / envelope encryption (the `v1:` prefix leaves the door open).
- Encrypting transcripts, summaries, or other columns.
- End-to-end encryption.
