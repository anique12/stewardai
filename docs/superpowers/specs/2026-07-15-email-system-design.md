# Email System — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan
**Context:** StewardAI is pivoting from "personal agent" to a meeting-centric product. Email becomes a first-class surface: lifecycle emails, post-meeting notes (with recipient config), pre-meeting prep notes, and digests/reminders. Today there is **no transactional email system** — the only email path is the chat agent sending via the user's connected Composio Gmail (an agent action). This design adds a dedicated, branded email system.

## Goals

- One reliable, branded email system covering all product touchpoints.
- Post-meeting notes with a simple, privacy-safe recipient model configurable in Settings and overridable per meeting.
- Pre-meeting prep emails for recurring meetings.
- Digests + action reminders.
- No double-sends, honored unsubscribes, good deliverability.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sending model | **Branded product address via a transactional ESP** | Consistent branding; one system for all emails; covers system emails (can't come from a user's Gmail). |
| ESP | **Resend** | Best DX, HTTP API callable from Python + Next.js, easy domain/DKIM, generous free tier. (Alternatives considered: SES — cheapest at scale, more setup; Postmark — great deliverability, pricier.) |
| Architecture | **Outbox table + sender worker** | Any trigger inserts a row; one Python sender renders + sends via Resend with retries/idempotency/suppression. Reliable, observable, decoupled; fits the existing worker pattern. Resend is the only vendor. |
| Recipient scope | **Only me / Everyone on the calendar invite** | Uses existing `meetings.attendees[]`; no team/workspace system to build. |
| Default sharing | **Only me by default** | Privacy/consent-safe; nothing goes to external attendees until the user opts in. |
| Scope | All four touchpoint groups, built in phases | User wants the full system; phasing keeps it shippable. |

Non-goals (YAGNI): managed workspace/team membership; a managed notification platform (Loops/Knock/Novu) — the DIY outbox is enough at this stage; multi-channel (Slack/SMS); domain-based internal/external recipient split.

## Architecture & data flow

```
[trigger] → insert email_outbox row → [sender worker] → Resend → inbox
 portal:  welcome, calendar_connected, manual_share
 backend: meeting_notes (teardown), meeting_prep (scheduler), digest/action_reminder (cron), bot_failed
```

- A single `stewardai.email` module owns Resend calls + template rendering.
- `email_outbox` is the single funnel. Every trigger — from the Next.js portal (via the Supabase service client) or the Python backend — **inserts a row**; nobody sends inline.
- The **sender worker** runs in the existing worker loop (alongside `action_worker`): polls `pending` rows where `scheduled_for <= now`, checks suppression, renders the template, sends via Resend (passing `dedup_key` as Resend's idempotency key), marks `sent`/`failed` with backoff.
- **One row per recipient** (not per email) so suppression, unsubscribe, and dedup are per-address, and one bad address never blocks the rest.

## Data model

### `email_outbox`
| col | purpose |
|---|---|
| `id`, `user_id` | owner |
| `kind` | `welcome` \| `calendar_connected` \| `bot_failed` \| `meeting_notes` \| `meeting_prep` \| `digest` \| `action_reminder` \| `manual_share` |
| `to_email` | single recipient |
| `meeting_id` | nullable |
| `dedup_key` | **unique** (e.g. `meeting_notes:{meeting_id}:{email}`) → no double-sends |
| `payload` | jsonb snapshot needed to render (notes/actions captured at trigger time) |
| `status` | `pending` \| `sent` \| `failed` \| `suppressed` \| `canceled` |
| `attempts`, `last_error` | retry bookkeeping |
| `scheduled_for` | future sends (prep, digest); defaults to now |
| `sent_at`, `created_at` | timestamps |

Unique index on `dedup_key`. Index on `(status, scheduled_for)` for the worker poll.

### `email_prefs` (per user)
`notes_enabled` (default true), `notes_recipients` (`only_me`|`everyone`, default `only_me`), `notes_include_transcript_link` (default true), `prep_enabled` + `prep_recipients`, `digest_frequency` (`off`|`daily`|`weekly`, default `off`), `action_reminders_enabled`. System emails are not user-disablable.

### Per-meeting override
`meetings.notes_recipients` (nullable enum) overrides the global default for that meeting.

### `email_suppressions`
`email`, `reason` (`unsubscribed`|`bounced`|`complained`), `created_at`. Written by Resend webhooks + the unsubscribe route; checked before every send.

## Touchpoint catalog

| Kind | Trigger | Recipients | Content | Dedup key |
|---|---|---|---|---|
| `welcome` | Portal, first sign-in (`auth/callback`) | Owner | Hello + how Steward works + connect-calendar CTA | `welcome:{user_id}` |
| `calendar_connected` | Portal, on calendar connect | Owner | "You're set — what happens next" | `calendar_connected:{user_id}` |
| `bot_failed` | Backend, on join failure | Owner only | "Steward couldn't join *X*" + reason + retry link | `bot_failed:{meeting_id}` |
| `meeting_notes` | Backend, `meeting_runner` teardown after summary persists | Per prefs/override (`only_me`→owner; `everyone`→`attendees[]`) | Summary + action items (+ transcript/recording link if toggled) | `meeting_notes:{meeting_id}:{email}` |
| `meeting_prep` | Backend, scheduler enqueues at `start − 1h`, **recurring only** | Per `prep_recipients` | Recap of last occurrence + open action items (reuses `build_meeting_brief`) | `meeting_prep:{meeting_id}:{email}` |
| `digest` | Backend, nightly cron (if `daily`/`weekly`) | Owner | Today's meetings + open actions | `digest:{user_id}:{date}` |
| `action_reminder` | Backend, cron when an action is due | Owner (+ assignee later) | Due action items | `action_reminder:{action_id}:{email}` |
| `manual_share` | Portal, "Share" button | User-chosen | Notes, review-before-send | `manual_share:{meeting_id}:{email}:{nonce}` |

Behavior notes:
- **`meeting_notes` recipient resolution:** per-meeting override wins; else global `notes_recipients`; default `only_me` means nothing external until opted in.
- **`reply-to` = owner's email** on notes/prep so attendee replies reach the human.
- **prep fires for recurring meetings only** (a one-off has no prior occurrence).

## Settings UI

New **"Email"** section in the Settings modal:
- **Meeting notes**: on/off · recipients radio (**Only me** / **Everyone on the invite**) · "include transcript & recording link" checkbox.
- **Meeting prep**: on/off · recipients radio.
- **Digest**: Off / Daily / Weekly.
- **Action reminders**: on/off.
- Note: *"System emails (welcome, calendar setup, join alerts) are always sent."*

**Per-meeting override** on the meeting detail page: a small "Notes go to: Only me ▾ / Everyone" control writing `meetings.notes_recipients`.

## Deliverability & compliance

- **Sending domain**: verify the chosen product domain in Resend (SPF, DKIM, DMARC). Use a subdomain (`mail.<domain>.ai`) to isolate product-email reputation. **Hard dependency on finalizing the domain name.**
- **Identity**: `Steward <notes@mail.<domain>.ai>`; `reply-to` = owner for notes/prep.
- **Unsubscribe** (required for anything to attendees — notes, prep, digest): `List-Unsubscribe` header + one-click footer link → inserts an `email_suppressions` row. Owner-only system emails exempt.
- **Suppression enforcement**: sender worker skips any `to_email` in `email_suppressions` (marks row `suppressed`). Resend **webhooks** (bounce/complaint/unsubscribe) feed the table via a portal webhook route.
- **CAN-SPAM**: physical postal address + clear identification in the footer of external emails.

## Error handling, retries, idempotency

- **Idempotency**: unique `dedup_key` (DB) + Resend idempotency key → a retried or duplicate trigger never double-sends.
- **Retries**: transient failure → `attempts++`, exponential backoff via `scheduled_for`; after N (e.g. 5) → `failed` + `last_error`. A `failed` owner-critical email (welcome/bot_failed) surfaces in logs (Loki); attendee emails just stop.
- **Snapshot at enqueue**: `payload` captures notes/actions at trigger time, so template edits don't change queued content and delayed sends reflect the meeting as it was.
- **No partial blast**: one row per recipient — one bad address never blocks the rest.

## Testing

- **Unit**: recipient resolution (only_me / everyone / per-meeting override); `dedup_key` generation; suppression check; prep-time calc (`start − 1h`, recurring-only); template rendering (snapshot per kind).
- **Integration**: enqueue → worker → send with a **mocked Resend client** (asserts idempotency key, recipient, suppression skip, retry/backoff on failure).
- **Manual/dev**: a `send test email` path per template + Resend sandbox/test mode so no real mail goes out in dev.

## Suggested phasing (for the implementation plan)

1. **Foundation**: `email_outbox` + `email_prefs` + `email_suppressions` tables; `stewardai.email` module (Resend client + template base + one template); sender worker; Resend domain verification.
2. **System/lifecycle**: `welcome`, `calendar_connected`, `bot_failed`.
3. **Post-meeting notes (core)**: recipient resolution, Settings UI, per-meeting override, `manual_share`, unsubscribe + suppression + webhook route.
4. **Pre-meeting prep**: scheduler enqueue at `start − 1h`, recurring-only.
5. **Digests & reminders**: nightly cron, frequency setting, action reminders.

## Dependencies / open items

- **Domain name** must be finalized (blocks Resend domain verification / branded from-address).
- **Resend account** + API key + verified domain + webhook secret.
- Physical postal address for the compliance footer.
