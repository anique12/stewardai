# Email System (Foundation + System Emails) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up StewardAI's branded transactional email system (Resend + an `email_outbox` table + a sender loop in the existing worker) and ship the first real emails: welcome, calendar-connected, and bot-failed.

**Architecture:** Every trigger (Next.js portal or Python backend) inserts a row into `email_outbox`; a sender loop folded into the existing `action_worker` process polls due rows, checks the suppression list, renders a Jinja2 template, and sends via Resend using the row's unique `dedup_key` as Resend's idempotency key. One row per recipient. Nothing sends inline.

**Tech Stack:** Python 3.11 (backend, `stewardai.email`), httpx (Resend HTTP API — no new send SDK), Jinja2 (templates), Supabase (Postgres + AsyncClient), Next.js/TypeScript (portal triggers). ESP: Resend.

**Scope:** This plan covers spec Phase 1 (Foundation) + Phase 2 (System/lifecycle emails) from `docs/superpowers/specs/2026-07-15-email-system-design.md`. Phases 3–5 (post-meeting notes, pre-meeting prep, digests/reminders) are separate follow-on plans that build on this foundation.

## Global Constraints

- Python: ruff clean, line length < 100 (E501). Existing style: `from __future__ import annotations`, `get_logger(...)`, guarded/best-effort so an email failure NEVER breaks a meeting or a login.
- No new send dependency: call Resend's REST API (`POST https://api.resend.com/emails`) via httpx (already a dep, 0.28.1). Add `jinja2` (already installed, 3.1.6) as an explicit dependency.
- All emails are gated by `Settings.email_enabled` (default `False`) — when off, enqueue is a no-op and the sender processes nothing, so dev/staging never send real mail.
- Idempotency is mandatory: every outbox row has a UNIQUE `dedup_key`; enqueue is insert-or-ignore-on-conflict; the sender passes `dedup_key` as Resend's `Idempotency-Key`.
- One row per recipient (suppression/unsubscribe/dedup are per-address).
- Supabase reads/writes from Python use the shared `AsyncClient` from `create_service_client(settings)`.

---

## File Structure

- Create: `portal/supabase/migrations/0018_email_system.sql` — `email_outbox`, `email_prefs`, `email_suppressions`, `profiles.email`.
- Create: `src/stewardai/email/__init__.py`
- Create: `src/stewardai/email/resend_client.py` — `ResendClient` (httpx → Resend).
- Create: `src/stewardai/email/keys.py` — `dedup_key_for(kind, **parts)`.
- Create: `src/stewardai/email/outbox.py` — `enqueue(...)`, `resolve_owner_email(...)`.
- Create: `src/stewardai/email/suppressions.py` — `is_suppressed(...)`.
- Create: `src/stewardai/email/templates.py` — Jinja2 env + `render(kind, payload) -> (subject, html)`.
- Create: `src/stewardai/email/templates/base.html`, `welcome.html`, `calendar_connected.html`, `bot_failed.html`.
- Create: `src/stewardai/email/sender.py` — `run_pending_emails_once(client, resend, settings)`.
- Modify: `src/stewardai/config.py` — Resend/email settings.
- Modify: `pyproject.toml` — add `jinja2`.
- Modify: `src/stewardai/scheduler/action_worker.py` — fold the email sender into the loop.
- Modify: `src/stewardai/scheduler/meeting_scheduler.py` — enqueue `bot_failed` when a meeting is marked failed.
- Create: `portal/src/lib/email/enqueue.ts` — `enqueueEmail(service, row)` (portal-side insert).
- Modify: `portal/src/app/auth/callback/route.ts` — store `profiles.email`; enqueue `welcome` + `calendar_connected`.
- Tests: `tests/email/test_resend_client.py`, `test_keys.py`, `test_outbox.py`, `test_suppressions.py`, `test_templates.py`, `test_sender.py`; `portal/src/lib/email/__tests__/enqueue.test.ts`.

---

## Task 1: Database migration

**Files:**
- Create: `portal/supabase/migrations/0018_email_system.sql`

**Interfaces:**
- Produces: tables `email_outbox`, `email_prefs`, `email_suppressions`; column `profiles.email`. Column names/enum values other tasks depend on: `email_outbox(kind, to_email, meeting_id, dedup_key, payload, status, attempts, last_error, scheduled_for, sent_at)`; `status` values `pending|sent|failed|suppressed|canceled`.

- [ ] **Step 1: Write the migration**

```sql
-- Email system: outbox (single send funnel), per-user prefs, suppression list.
-- profiles.email lets the backend resolve an owner's address without an auth-admin call.

alter table public.profiles
  add column if not exists email text;

create table if not exists public.email_outbox (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in (
                  'welcome','calendar_connected','bot_failed','meeting_notes',
                  'meeting_prep','digest','action_reminder','manual_share')),
  to_email      text not null,
  meeting_id    uuid references public.meetings(id) on delete cascade,
  dedup_key     text not null unique,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
                  check (status in ('pending','sent','failed','suppressed','canceled')),
  attempts      int not null default 0,
  last_error    text,
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists email_outbox_due_idx
  on public.email_outbox (status, scheduled_for);

create table if not exists public.email_prefs (
  user_id                       uuid primary key references auth.users(id) on delete cascade,
  notes_enabled                 boolean not null default true,
  notes_recipients              text not null default 'only_me'
                                  check (notes_recipients in ('only_me','everyone')),
  notes_include_transcript_link boolean not null default true,
  prep_enabled                  boolean not null default false,
  prep_recipients               text not null default 'only_me'
                                  check (prep_recipients in ('only_me','everyone')),
  digest_frequency              text not null default 'off'
                                  check (digest_frequency in ('off','daily','weekly')),
  action_reminders_enabled      boolean not null default false
);

create table if not exists public.email_suppressions (
  email      text primary key,
  reason     text not null check (reason in ('unsubscribed','bounced','complained')),
  created_at timestamptz not null default now()
);

-- meetings gets a per-meeting notes override (used by the later notes plan; added now
-- so the schema is stable). NULL = fall back to email_prefs.notes_recipients.
alter table public.meetings
  add column if not exists notes_recipients text
    check (notes_recipients is null or notes_recipients in ('only_me','everyone'));

-- RLS: outbox/prefs/suppressions are service-role only (no client access).
alter table public.email_outbox enable row level security;
alter table public.email_prefs enable row level security;
alter table public.email_suppressions enable row level security;
-- email_prefs is user-readable/writable for the Settings UI (later plan).
create policy email_prefs_owner on public.email_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Apply and verify**

Run (locally against the dev DB, or note for the user to apply):
```bash
psql "$SUPABASE_DB_URL" -f portal/supabase/migrations/0018_email_system.sql
psql "$SUPABASE_DB_URL" -c "\d public.email_outbox"
```
Expected: table `email_outbox` prints with the columns above; no errors. If applying via the Supabase dashboard SQL editor instead, paste the file and run.

- [ ] **Step 3: Commit**

```bash
git add portal/supabase/migrations/0018_email_system.sql
git commit -m "feat(db): email_outbox/email_prefs/email_suppressions + profiles.email"
```

---

## Task 2: Email settings

**Files:**
- Modify: `src/stewardai/config.py`
- Test: `tests/email/test_config_email.py`

**Interfaces:**
- Produces: `Settings.email_enabled: bool`, `Settings.resend_api_key: str | None`, `Settings.email_from: str`, `Settings.email_reply_to: str | None`, `Settings.public_app_url: str`.

- [ ] **Step 1: Write the failing test**

```python
# tests/email/test_config_email.py
from stewardai.config import Settings


def test_email_settings_defaults():
    s = Settings(_env_file=None)
    assert s.email_enabled is False
    assert s.resend_api_key is None
    assert s.email_from  # has a non-empty default
    assert s.public_app_url  # has a non-empty default
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/email/test_config_email.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'email_enabled'`

- [ ] **Step 3: Add the settings**

In `src/stewardai/config.py`, add these fields to the `Settings` class (near the other integration settings, e.g. after the Vexa block ~line 129):

```python
    # --- Email (Resend transactional) ---
    # Gated: when False, enqueue is a no-op and the sender processes nothing, so
    # dev/staging never send real mail. Set True in prod once the domain is verified.
    email_enabled: bool = False
    resend_api_key: str | None = None
    # From header, e.g. "Steward <notes@mail.yourdomain.ai>". Placeholder default
    # is safe because email_enabled defaults False.
    email_from: str = "Steward <notes@example.com>"
    # Replies to owner-facing system emails go here (optional); notes/prep set
    # reply-to per-message to the owner in the later plan.
    email_reply_to: str | None = None
    # Base URL for links in emails (e.g. https://app.yourdomain.ai).
    public_app_url: str = "http://localhost:3000"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/email/test_config_email.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/config.py tests/email/test_config_email.py
git commit -m "feat(email): Resend/email settings (gated by email_enabled)"
```

---

## Task 3: ResendClient

**Files:**
- Create: `src/stewardai/email/__init__.py` (empty)
- Create: `src/stewardai/email/resend_client.py`
- Test: `tests/email/test_resend_client.py`

**Interfaces:**
- Produces: `class ResendClient(api_key: str)` with
  `async def send(self, *, sender: str, to: str, subject: str, html: str, reply_to: str | None = None, headers: dict[str,str] | None = None, idempotency_key: str | None = None) -> str` — returns the Resend message id; raises `httpx.HTTPStatusError` on non-2xx (so the sender can retry).

- [ ] **Step 1: Write the failing test**

```python
# tests/email/test_resend_client.py
from __future__ import annotations

import httpx

from stewardai.email.resend_client import ResendClient


class _Resp:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("err", request=None, response=None)

    def json(self):
        return self._p


async def test_send_posts_to_resend_with_auth_and_idempotency(monkeypatch):
    captured = {}

    async def fake_post(self, url, *, json=None, headers=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return _Resp({"id": "msg_123"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    client = ResendClient("re_test")
    mid = await client.send(
        sender="Steward <notes@x.ai>",
        to="a@b.com",
        subject="Hi",
        html="<p>Hi</p>",
        reply_to="owner@x.ai",
        idempotency_key="welcome:u1",
    )

    assert mid == "msg_123"
    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["headers"]["Authorization"] == "Bearer re_test"
    assert captured["headers"]["Idempotency-Key"] == "welcome:u1"
    assert captured["json"]["from"] == "Steward <notes@x.ai>"
    assert captured["json"]["to"] == ["a@b.com"]
    assert captured["json"]["reply_to"] == "owner@x.ai"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/email/test_resend_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stewardai.email.resend_client'`

- [ ] **Step 3: Write the implementation**

```python
# src/stewardai/email/resend_client.py
"""Thin Resend HTTP client (httpx). No SDK dependency."""

from __future__ import annotations

import httpx

from stewardai.common.logging import get_logger

_log = get_logger("email.resend_client")
_API = "https://api.resend.com/emails"


class ResendClient:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def send(
        self,
        *,
        sender: str,
        to: str,
        subject: str,
        html: str,
        reply_to: str | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        """POST one email to Resend. Returns the message id; raises on non-2xx."""
        body: dict = {"from": sender, "to": [to], "subject": subject, "html": html}
        if reply_to:
            body["reply_to"] = reply_to
        if headers:
            body["headers"] = headers
        req_headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            req_headers["Idempotency-Key"] = idempotency_key
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(_API, json=body, headers=req_headers)
            resp.raise_for_status()
            data = resp.json()
        return str(data.get("id") or "")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/email/test_resend_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/email/__init__.py src/stewardai/email/resend_client.py tests/email/test_resend_client.py
git commit -m "feat(email): ResendClient httpx wrapper"
```

---

## Task 4: Dedup keys + enqueue

**Files:**
- Create: `src/stewardai/email/keys.py`
- Create: `src/stewardai/email/outbox.py`
- Test: `tests/email/test_keys.py`, `tests/email/test_outbox.py`

**Interfaces:**
- Consumes: Supabase `AsyncClient`.
- Produces:
  - `dedup_key_for(kind: str, **parts: str) -> str` — deterministic key, e.g. `dedup_key_for("welcome", user_id="u1") == "welcome:u1"`; ordered by insertion of parts.
  - `async def enqueue(client, *, user_id: str, kind: str, to_email: str, dedup_key: str, meeting_id: str | None = None, payload: dict | None = None, scheduled_for: str | None = None, enabled: bool = True) -> bool` — inserts a row; returns False (no-op) when `enabled` is False; swallows unique-violation on `dedup_key` (returns False) so a repeated trigger never double-enqueues. Never raises.
  - `async def resolve_owner_email(client, user_id: str) -> str | None` — reads `profiles.email`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/email/test_keys.py
from stewardai.email.keys import dedup_key_for


def test_dedup_key_joins_kind_and_parts_in_order():
    assert dedup_key_for("welcome", user_id="u1") == "welcome:u1"
    assert dedup_key_for("meeting_notes", meeting_id="m1", email="a@b.com") == \
        "meeting_notes:m1:a@b.com"
```

```python
# tests/email/test_outbox.py
from __future__ import annotations

from stewardai.email.outbox import enqueue, resolve_owner_email


class _Table:
    def __init__(self, store, raise_conflict=False):
        self._store, self._raise = store, raise_conflict
        self._payload = None

    def insert(self, row):
        self._payload = row
        return self

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def limit(self, *_):
        return self

    def maybe_single(self):
        return self

    async def execute(self):
        if self._payload is not None:
            if self._raise:
                raise Exception('duplicate key value violates unique constraint')
            self._store.append(self._payload)
        return type("R", (), {"data": {"email": "owner@x.ai"}})()


class _Client:
    def __init__(self, store, raise_conflict=False):
        self._store, self._raise = store, raise_conflict

    def table(self, _name):
        return _Table(self._store, self._raise)


async def test_enqueue_inserts_row():
    store = []
    ok = await enqueue(
        _Client(store), user_id="u1", kind="welcome", to_email="owner@x.ai",
        dedup_key="welcome:u1", enabled=True,
    )
    assert ok is True
    assert store[0]["dedup_key"] == "welcome:u1"
    assert store[0]["status"] == "pending"


async def test_enqueue_noop_when_disabled():
    store = []
    ok = await enqueue(
        _Client(store), user_id="u1", kind="welcome", to_email="o@x.ai",
        dedup_key="welcome:u1", enabled=False,
    )
    assert ok is False and store == []


async def test_enqueue_swallows_duplicate():
    ok = await enqueue(
        _Client([], raise_conflict=True), user_id="u1", kind="welcome",
        to_email="o@x.ai", dedup_key="welcome:u1", enabled=True,
    )
    assert ok is False


async def test_resolve_owner_email():
    assert await resolve_owner_email(_Client([]), "u1") == "owner@x.ai"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/email/test_keys.py tests/email/test_outbox.py -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```python
# src/stewardai/email/keys.py
"""Deterministic dedup keys for email_outbox (also used as Resend idempotency keys)."""

from __future__ import annotations


def dedup_key_for(kind: str, **parts: str) -> str:
    return ":".join([kind, *[str(v) for v in parts.values()]])
```

```python
# src/stewardai/email/outbox.py
"""Enqueue emails into email_outbox + owner-email resolution. Best-effort, never raises."""

from __future__ import annotations

from stewardai.common.logging import get_logger

_log = get_logger("email.outbox")


async def enqueue(
    client,  # noqa: ANN001
    *,
    user_id: str,
    kind: str,
    to_email: str,
    dedup_key: str,
    meeting_id: str | None = None,
    payload: dict | None = None,
    scheduled_for: str | None = None,
    enabled: bool = True,
) -> bool:
    """Insert one pending outbox row. No-op when disabled. Swallows the unique
    dedup_key violation (a repeated trigger never double-sends). Never raises."""
    if not enabled or not to_email:
        return False
    row = {
        "user_id": user_id,
        "kind": kind,
        "to_email": to_email,
        "dedup_key": dedup_key,
        "payload": payload or {},
    }
    if meeting_id:
        row["meeting_id"] = meeting_id
    if scheduled_for:
        row["scheduled_for"] = scheduled_for
    try:
        await client.table("email_outbox").insert(row).execute()
        _log.info("email_enqueued", kind=kind, dedup_key=dedup_key)
        return True
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "duplicate key" in msg or "unique constraint" in msg:
            return False  # already enqueued — expected, not an error
        _log.warning("email_enqueue_failed", kind=kind, error=msg[:200])
        return False


async def resolve_owner_email(client, user_id: str) -> str | None:  # noqa: ANN001
    """Owner's email from profiles.email (best-effort)."""
    try:
        resp = await (
            client.table("profiles").select("email").eq("user_id", user_id).limit(1).maybe_single().execute()
        )
        data = resp.data or {}
        return (data.get("email") or None) if isinstance(data, dict) else None
    except Exception:  # noqa: BLE001
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/email/test_keys.py tests/email/test_outbox.py -v`
Expected: PASS (4 + 1)

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/email/keys.py src/stewardai/email/outbox.py tests/email/test_keys.py tests/email/test_outbox.py
git commit -m "feat(email): dedup keys + outbox enqueue + owner-email resolve"
```

---

## Task 5: Suppression check

**Files:**
- Create: `src/stewardai/email/suppressions.py`
- Test: `tests/email/test_suppressions.py`

**Interfaces:**
- Produces: `async def is_suppressed(client, email: str) -> bool` — True if the address has a row in `email_suppressions`. Never raises (returns False on error — fail-open is acceptable; a bounce webhook is the real guard).

- [ ] **Step 1: Write the failing test**

```python
# tests/email/test_suppressions.py
from __future__ import annotations

from stewardai.email.suppressions import is_suppressed


class _Client:
    def __init__(self, hit):
        self._hit = hit

    def table(self, _):
        return self

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def limit(self, *_):
        return self

    async def execute(self):
        return type("R", (), {"data": [{"email": "x@y.com"}] if self._hit else []})()


async def test_suppressed_true_when_present():
    assert await is_suppressed(_Client(True), "x@y.com") is True


async def test_suppressed_false_when_absent():
    assert await is_suppressed(_Client(False), "x@y.com") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/email/test_suppressions.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```python
# src/stewardai/email/suppressions.py
"""Suppression-list check (unsubscribed / bounced / complained)."""

from __future__ import annotations


async def is_suppressed(client, email: str) -> bool:  # noqa: ANN001
    try:
        resp = await (
            client.table("email_suppressions").select("email").eq("email", email).limit(1).execute()
        )
        return bool(resp.data)
    except Exception:  # noqa: BLE001
        return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/email/test_suppressions.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/email/suppressions.py tests/email/test_suppressions.py
git commit -m "feat(email): suppression-list check"
```

---

## Task 6: Templates (Jinja2)

**Files:**
- Modify: `pyproject.toml` (add `jinja2>=3.1`)
- Create: `src/stewardai/email/templates.py`
- Create: `src/stewardai/email/templates/base.html`, `welcome.html`, `calendar_connected.html`, `bot_failed.html`
- Test: `tests/email/test_templates.py`

**Interfaces:**
- Consumes: `Settings.public_app_url` (passed in `payload["app_url"]` by the sender).
- Produces: `render(kind: str, payload: dict) -> tuple[str, str]` — returns `(subject, html)`. Raises `KeyError` for an unknown kind (caller guards). Templates live in `templates/<kind>.html` and extend `base.html`; each defines a `{% block subject %}` and `{% block content %}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/email/test_templates.py
from stewardai.email.templates import render


def test_welcome_render_has_subject_and_name():
    subject, html = render("welcome", {"name": "Anique", "app_url": "https://app.x.ai"})
    assert "Steward" in subject
    assert "Anique" in html
    assert "https://app.x.ai" in html


def test_bot_failed_render_includes_meeting_title():
    subject, html = render("bot_failed", {"title": "Daily Standup", "app_url": "https://app.x.ai"})
    assert "Daily Standup" in html
    assert subject
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/email/test_templates.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Add jinja2 to pyproject**

In `pyproject.toml` `dependencies`, add: `"jinja2>=3.1",`

- [ ] **Step 4: Write base + kind templates**

`src/stewardai/email/templates/base.html`:
```html
<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#1f2421;background:#f4f2ec;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e7e3d8;border-radius:14px;padding:28px">
    <div style="font-weight:700;font-size:18px;color:#2c6b58;margin-bottom:16px">StewardAI</div>
    {% block content %}{% endblock %}
  </div>
  <div style="max-width:560px;margin:12px auto 0;color:#9a978c;font-size:11px;line-height:1.5">
    {% block footer %}You're receiving this because you use StewardAI.{% endblock %}
  </div>
</body></html>
```

`src/stewardai/email/templates/welcome.html`:
```html
{% extends "base.html" %}
{% block subject %}Welcome to Steward{% endblock %}
{% block content %}
  <p>Hi {{ name or "there" }},</p>
  <p>Steward joins your meetings, takes notes, and captures action items automatically.</p>
  <p><a href="{{ app_url }}/app" style="color:#2c6b58;font-weight:600">Open Steward →</a></p>
{% endblock %}
```

`src/stewardai/email/templates/calendar_connected.html`:
```html
{% extends "base.html" %}
{% block subject %}Your calendar is connected{% endblock %}
{% block content %}
  <p>Hi {{ name or "there" }},</p>
  <p>Steward can now see your schedule and will join the meetings you opt into.</p>
  <p><a href="{{ app_url }}/app/meetings" style="color:#2c6b58;font-weight:600">Review upcoming meetings →</a></p>
{% endblock %}
```

`src/stewardai/email/templates/bot_failed.html`:
```html
{% extends "base.html" %}
{% block subject %}Steward couldn't join your meeting{% endblock %}
{% block content %}
  <p>Steward wasn't admitted to <strong>{{ title or "your meeting" }}</strong>{% if reason %} ({{ reason }}){% endif %}.</p>
  <p>You can retry from the meeting page.</p>
  <p><a href="{{ app_url }}/app/meetings" style="color:#2c6b58;font-weight:600">Go to meetings →</a></p>
{% endblock %}
```

- [ ] **Step 5: Write the renderer**

```python
# src/stewardai/email/templates.py
"""Jinja2 email rendering. Each kind extends base.html and defines subject + content."""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_DIR = Path(__file__).parent / "templates"
_env = Environment(
    loader=FileSystemLoader(str(_DIR)),
    autoescape=select_autoescape(["html"]),
)


def render(kind: str, payload: dict) -> tuple[str, str]:
    """Return (subject, html) for an email kind. Raises KeyError on unknown kind."""
    try:
        tmpl = _env.get_template(f"{kind}.html")
    except Exception as exc:  # noqa: BLE001
        raise KeyError(f"no email template for kind={kind}") from exc
    html = tmpl.render(**payload)
    # subject block is rendered separately
    subject_block = tmpl.blocks.get("subject")
    subject = ""
    if subject_block is not None:
        ctx = tmpl.new_context(payload)
        subject = "".join(subject_block(ctx)).strip()
    return subject, html
```

- [ ] **Step 6: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/email/test_templates.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml src/stewardai/email/templates.py src/stewardai/email/templates/ tests/email/test_templates.py
git commit -m "feat(email): Jinja2 templates (base, welcome, calendar_connected, bot_failed)"
```

---

## Task 7: Sender loop

**Files:**
- Create: `src/stewardai/email/sender.py`
- Test: `tests/email/test_sender.py`

**Interfaces:**
- Consumes: `ResendClient`, `render`, `is_suppressed`, Supabase `AsyncClient`, `Settings`.
- Produces: `async def run_pending_emails_once(client, resend, settings) -> int` — processes all `pending` rows with `scheduled_for <= now`; for each: if `is_suppressed` → mark `suppressed`; else render(kind, payload merged with `{"app_url": settings.public_app_url}`) and `resend.send(...)` with `idempotency_key=dedup_key`, `sender=settings.email_from`, `reply_to=settings.email_reply_to`; on success mark `sent`+`sent_at`; on failure `attempts++`, `last_error`, and mark `failed` when `attempts >= 5` else push `scheduled_for` out (backoff). Returns count sent. Never raises.

- [ ] **Step 1: Write the failing test**

```python
# tests/email/test_sender.py
from __future__ import annotations

from stewardai.email.sender import run_pending_emails_once


class _Settings:
    email_from = "Steward <n@x.ai>"
    email_reply_to = None
    public_app_url = "https://app.x.ai"


class _FakeResend:
    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    async def send(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise RuntimeError("boom")
        return "msg_1"


class _Q:
    """Minimal fake: one pending row; records updates."""
    def __init__(self, row, suppressed=False):
        self._row, self._suppressed = row, suppressed
        self.updates = []
        self._mode = None

    def table(self, name):
        self._mode = name
        return self

    def select(self, *_):
        self._op = "select"
        return self

    def update(self, patch):
        self._op, self._patch = "update", patch
        return self

    def eq(self, *a):
        self._eq = a
        return self

    def lte(self, *_):
        return self

    def limit(self, *_):
        return self

    def order(self, *_ , **__):
        return self

    async def execute(self):
        if self._mode == "email_suppressions":
            return type("R", (), {"data": [{"email": "x"}] if self._suppressed else []})()
        if self._op == "select":
            return type("R", (), {"data": [self._row]})()
        self.updates.append(self._patch)
        return type("R", (), {"data": [{}]})()


async def test_sends_pending_and_marks_sent():
    row = {"id": "1", "kind": "welcome", "to_email": "o@x.ai", "dedup_key": "welcome:u1",
           "payload": {"name": "A"}, "attempts": 0}
    q, resend = _Q(row), _FakeResend()
    n = await run_pending_emails_once(q, resend, _Settings())
    assert n == 1
    assert resend.calls[0]["idempotency_key"] == "welcome:u1"
    assert any(u.get("status") == "sent" for u in q.updates)


async def test_suppressed_marks_suppressed_and_does_not_send():
    row = {"id": "1", "kind": "welcome", "to_email": "o@x.ai", "dedup_key": "welcome:u1",
           "payload": {}, "attempts": 0}
    q, resend = _Q(row, suppressed=True), _FakeResend()
    n = await run_pending_emails_once(q, resend, _Settings())
    assert n == 0
    assert resend.calls == []
    assert any(u.get("status") == "suppressed" for u in q.updates)


async def test_failure_increments_attempts():
    row = {"id": "1", "kind": "welcome", "to_email": "o@x.ai", "dedup_key": "welcome:u1",
           "payload": {}, "attempts": 0}
    q, resend = _Q(row), _FakeResend(fail=True)
    n = await run_pending_emails_once(q, resend, _Settings())
    assert n == 0
    assert any(u.get("attempts") == 1 for u in q.updates)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/email/test_sender.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```python
# src/stewardai/email/sender.py
"""Drain email_outbox: render + send via Resend, with suppression, retries, idempotency."""

from __future__ import annotations

import contextlib
from datetime import datetime, timedelta, timezone

from stewardai.common.logging import get_logger
from stewardai.email.suppressions import is_suppressed
from stewardai.email.templates import render

_log = get_logger("email.sender")
_MAX_ATTEMPTS = 5


async def run_pending_emails_once(client, resend, settings) -> int:  # noqa: ANN001
    """Process due pending outbox rows once. Returns the number sent. Never raises."""
    now = datetime.now(timezone.utc)
    try:
        resp = await (
            client.table("email_outbox")
            .select("id, kind, to_email, dedup_key, payload, attempts")
            .eq("status", "pending")
            .lte("scheduled_for", now.isoformat())
            .limit(100)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:  # noqa: BLE001
        _log.warning("email_poll_failed", error=str(exc))
        return 0

    sent = 0
    for row in rows:
        rid, to_email = row["id"], row["to_email"]
        # Suppression: skip + mark, never send.
        if await is_suppressed(client, to_email):
            await _update(client, rid, {"status": "suppressed"})
            continue
        try:
            payload = dict(row.get("payload") or {})
            payload.setdefault("app_url", settings.public_app_url)
            subject, html = render(row["kind"], payload)
            await resend.send(
                sender=settings.email_from,
                to=to_email,
                subject=subject,
                html=html,
                reply_to=settings.email_reply_to,
                idempotency_key=row["dedup_key"],
            )
            await _update(client, rid, {"status": "sent", "sent_at": now.isoformat()})
            sent += 1
        except Exception as exc:  # noqa: BLE001
            attempts = int(row.get("attempts") or 0) + 1
            patch = {"attempts": attempts, "last_error": str(exc)[:500]}
            if attempts >= _MAX_ATTEMPTS:
                patch["status"] = "failed"
            else:
                backoff = timedelta(minutes=2 ** attempts)
                patch["scheduled_for"] = (now + backoff).isoformat()
            await _update(client, rid, patch)
            _log.warning("email_send_failed", kind=row.get("kind"), attempts=attempts, error=str(exc)[:200])
    return sent


async def _update(client, rid: str, patch: dict) -> None:  # noqa: ANN001
    with contextlib.suppress(Exception):
        await client.table("email_outbox").update(patch).eq("id", rid).execute()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/email/test_sender.py -v`
Expected: PASS (3)

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/email/sender.py tests/email/test_sender.py
git commit -m "feat(email): sender loop (suppression, render, Resend, retries, idempotency)"
```

---

## Task 8: Wire the sender into the worker loop

**Files:**
- Modify: `src/stewardai/scheduler/action_worker.py`

**Interfaces:**
- Consumes: `run_pending_emails_once`, `ResendClient`, `Settings.email_enabled`, `Settings.resend_api_key`.

- [ ] **Step 1: Add email processing to `run_forever`**

In `src/stewardai/scheduler/action_worker.py`, modify `run_forever` to build a `ResendClient` once (only when enabled) and call the email sender each cycle. Replace the body of `run_forever` with:

```python
async def run_forever(interval_s: int = 60) -> None:
    """Poll approved actions AND drain the email outbox each cycle."""
    from stewardai.config import get_settings
    from stewardai.email.resend_client import ResendClient
    from stewardai.email.sender import run_pending_emails_once
    from stewardai.integrations.composio_service import ComposioService
    from stewardai.integrations.supabase_client import create_service_client

    s = get_settings()
    client = await create_service_client(s)
    service = ComposioService()
    resend = ResendClient(s.resend_api_key) if (s.email_enabled and s.resend_api_key) else None

    _log.info("action_worker_started", interval_s=interval_s, email=bool(resend))
    while True:
        try:
            n = await run_pending_actions_once(client, service)
            if n:
                _log.info("action_worker_cycle_done", processed=n)
        except Exception as exc:  # noqa: BLE001
            _log.warning("action_worker_cycle_error", error=str(exc))
        if resend is not None:
            try:
                m = await run_pending_emails_once(client, resend, s)
                if m:
                    _log.info("email_sender_cycle_done", sent=m)
            except Exception as exc:  # noqa: BLE001
                _log.warning("email_sender_cycle_error", error=str(exc))
        await asyncio.sleep(interval_s)
```

- [ ] **Step 2: Verify import + lint**

Run:
```bash
.venv/bin/python -c "import stewardai.scheduler.action_worker" && .venv/bin/ruff check src/stewardai/scheduler/action_worker.py
```
Expected: no import error; ruff "All checks passed!"

- [ ] **Step 3: Commit**

```bash
git add src/stewardai/scheduler/action_worker.py
git commit -m "feat(email): drain outbox in the action_worker loop"
```

---

## Task 9: Portal enqueue helper

**Files:**
- Create: `portal/src/lib/email/enqueue.ts`
- Test: `portal/src/lib/email/__tests__/enqueue.test.ts`

**Interfaces:**
- Consumes: Supabase service client (`createServiceClient()`).
- Produces: `enqueueEmail(service, row: { userId: string; kind: string; toEmail: string; dedupKey: string; payload?: Record<string, unknown> }): Promise<void>` — inserts into `email_outbox`; swallows the unique-violation on `dedup_key` (code `23505`) and any error (never blocks the caller).

- [ ] **Step 1: Write the failing test**

```typescript
// portal/src/lib/email/__tests__/enqueue.test.ts
import { enqueueEmail } from "@/lib/email/enqueue";

function fakeService(error: unknown = null) {
  const calls: unknown[] = [];
  return {
    calls,
    from() {
      return { insert: async (row: unknown) => { calls.push(row); return { error }; } };
    },
  };
}

describe("enqueueEmail", () => {
  it("inserts a pending outbox row", async () => {
    const svc = fakeService();
    await enqueueEmail(svc as never, {
      userId: "u1", kind: "welcome", toEmail: "o@x.ai", dedupKey: "welcome:u1",
    });
    expect(svc.calls[0]).toMatchObject({ user_id: "u1", kind: "welcome", dedup_key: "welcome:u1" });
  });

  it("does not throw on duplicate key", async () => {
    const svc = fakeService({ code: "23505" });
    await expect(
      enqueueEmail(svc as never, { userId: "u1", kind: "welcome", toEmail: "o@x.ai", dedupKey: "welcome:u1" })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx jest src/lib/email/__tests__/enqueue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// portal/src/lib/email/enqueue.ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Insert one pending email_outbox row. Best-effort: a duplicate dedup_key (23505)
 * or any error is swallowed so it never blocks the request path (login, connect).
 */
export async function enqueueEmail(
  service: SupabaseClient,
  row: { userId: string; kind: string; toEmail: string; dedupKey: string; payload?: Record<string, unknown> }
): Promise<void> {
  try {
    const { error } = await service.from("email_outbox").insert({
      user_id: row.userId,
      kind: row.kind,
      to_email: row.toEmail,
      dedup_key: row.dedupKey,
      payload: row.payload ?? {},
    });
    // 23505 = unique_violation → already enqueued; anything else we log-and-ignore.
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("enqueueEmail failed", error);
    }
  } catch (e) {
    console.error("enqueueEmail threw", e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal && npx jest src/lib/email/__tests__/enqueue.test.ts`
Expected: PASS (2)

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/email/enqueue.ts portal/src/lib/email/__tests__/enqueue.test.ts
git commit -m "feat(email): portal enqueueEmail helper"
```

---

## Task 10: Welcome + calendar-connected triggers (portal)

**Files:**
- Modify: `portal/src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: `enqueueEmail`, the existing `createServiceClient()`, `data.user`.

- [ ] **Step 1: Store profiles.email + enqueue welcome on the profile upsert**

In `portal/src/app/auth/callback/route.ts`, update the profile upsert to include `email`, and enqueue the welcome email right after (dedup guarantees once):

```typescript
  // Upsert profile (now also stores email for backend owner-email resolution)
  await service.from("profiles").upsert(
    {
      user_id: data.user.id,
      display_name: data.user.user_metadata?.full_name ?? null,
      email: data.user.email ?? null,
    },
    { onConflict: "user_id" }
  );

  const { enqueueEmail } = await import("@/lib/email/enqueue");
  if (data.user.email) {
    await enqueueEmail(service, {
      userId: data.user.id,
      kind: "welcome",
      toEmail: data.user.email,
      dedupKey: `welcome:${data.user.id}`,
      payload: { name: data.user.user_metadata?.full_name ?? null },
    });
  }
```

- [ ] **Step 2: Enqueue calendar_connected when the calendar is connected**

In the same file, inside the `if (calendarConnected) { ... }` block (right after the `calendar_connections` upsert), add:

```typescript
    if (data.user.email) {
      const { enqueueEmail } = await import("@/lib/email/enqueue");
      await enqueueEmail(service, {
        userId: data.user.id,
        kind: "calendar_connected",
        toEmail: data.user.email,
        dedupKey: `calendar_connected:${data.user.id}`,
        payload: { name: data.user.user_metadata?.full_name ?? null },
      });
    }
```

- [ ] **Step 3: Verify build/typecheck**

Run: `cd portal && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "auth/callback" || echo "ok"`
Expected: `ok` (no type errors in the file).

- [ ] **Step 4: Commit**

```bash
git add portal/src/app/auth/callback/route.ts
git commit -m "feat(email): enqueue welcome + calendar_connected on auth callback; store profiles.email"
```

---

## Task 11: Bot-failed trigger (backend)

**Files:**
- Modify: `src/stewardai/scheduler/meeting_scheduler.py`
- Test: `tests/email/test_bot_failed_enqueue.py`

**Interfaces:**
- Consumes: `enqueue`, `resolve_owner_email`, `dedup_key_for`, `Settings.email_enabled`.
- Produces: helper `async def enqueue_bot_failed(client, settings, *, user_id, meeting_id, title, reason)` in `src/stewardai/email/outbox.py` — resolves owner email, enqueues a `bot_failed` row (dedup `bot_failed:{meeting_id}`). Called where the scheduler marks a meeting `failed`.

- [ ] **Step 1: Write the failing test**

```python
# tests/email/test_bot_failed_enqueue.py
from __future__ import annotations

from stewardai.email.outbox import enqueue_bot_failed


class _Settings:
    email_enabled = True


class _Table:
    def __init__(self, store):
        self._store, self._payload = store, None

    def insert(self, row):
        self._payload = row
        return self

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def limit(self, *_):
        return self

    def maybe_single(self):
        return self

    async def execute(self):
        if self._payload is not None:
            self._store.append(self._payload)
            return type("R", (), {"data": [{}]})()
        return type("R", (), {"data": {"email": "owner@x.ai"}})()


class _Client:
    def __init__(self, store):
        self._store = store

    def table(self, _):
        return _Table(self._store)


async def test_enqueue_bot_failed_resolves_owner_and_inserts():
    store = []
    await enqueue_bot_failed(
        _Client(store), _Settings(), user_id="u1", meeting_id="m1",
        title="Daily Standup", reason="not admitted",
    )
    assert store and store[0]["kind"] == "bot_failed"
    assert store[0]["to_email"] == "owner@x.ai"
    assert store[0]["dedup_key"] == "bot_failed:m1"
    assert store[0]["payload"]["title"] == "Daily Standup"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/email/test_bot_failed_enqueue.py -v`
Expected: FAIL — `enqueue_bot_failed` not defined.

- [ ] **Step 3: Add the helper to outbox.py**

Append to `src/stewardai/email/outbox.py`:

```python
async def enqueue_bot_failed(
    client,  # noqa: ANN001
    settings,  # noqa: ANN001
    *,
    user_id: str,
    meeting_id: str,
    title: str | None,
    reason: str | None,
) -> None:
    """Enqueue the owner-only 'Steward couldn't join' email. Best-effort."""
    from stewardai.email.keys import dedup_key_for

    email = await resolve_owner_email(client, user_id)
    if not email:
        return
    await enqueue(
        client,
        user_id=user_id,
        kind="bot_failed",
        to_email=email,
        dedup_key=dedup_key_for("bot_failed", meeting_id=meeting_id),
        meeting_id=meeting_id,
        payload={"title": title, "reason": reason},
        enabled=getattr(settings, "email_enabled", False),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/email/test_bot_failed_enqueue.py -v`
Expected: PASS

- [ ] **Step 5: Call it where the scheduler marks a meeting failed**

In `src/stewardai/scheduler/meeting_scheduler.py`, find the block that sets a meeting's `bot_status` to `"failed"` on a spawn exception (search for `"failed"`). Immediately after that DB update, add a guarded call. The scheduler already has the meeting row's `user_id`, `id` (uuid), and `title` in scope there (use the actual variable names present):

```python
        with contextlib.suppress(Exception):
            from stewardai.email.outbox import enqueue_bot_failed

            await enqueue_bot_failed(
                client, settings,
                user_id=meeting_user_id,
                meeting_id=meeting_uuid,
                title=meeting_title,
                reason=str(exc)[:200],
            )
```

If the exact variable names differ, map them: `meeting_user_id`→the row's user_id, `meeting_uuid`→`meetings.id`, `meeting_title`→the row's title, `exc`→the caught exception. Confirm `client` (Supabase) and `settings` are in scope; if `settings` isn't, add `from stewardai.config import get_settings; settings = get_settings()` above the call.

- [ ] **Step 6: Verify import + lint**

Run:
```bash
.venv/bin/python -c "import stewardai.scheduler.meeting_scheduler" && .venv/bin/ruff check src/stewardai/scheduler/meeting_scheduler.py src/stewardai/email/outbox.py
```
Expected: no import error; ruff clean.

- [ ] **Step 7: Commit**

```bash
git add src/stewardai/email/outbox.py src/stewardai/scheduler/meeting_scheduler.py tests/email/test_bot_failed_enqueue.py
git commit -m "feat(email): enqueue bot_failed email when a meeting fails to join"
```

---

## Task 12: Full suite + deploy notes

**Files:** none (verification task)

- [ ] **Step 1: Run the whole email test suite + lint**

Run:
```bash
.venv/bin/python -m pytest tests/email/ -q && .venv/bin/ruff check src/stewardai/email/
cd portal && npx jest src/lib/email/
```
Expected: all pass; ruff clean.

- [ ] **Step 2: Record deploy/go-live steps (do not execute here)**

Document (in the PR description or a comment) the go-live checklist — these are the ONLY things standing between this code and real emails:
1. Create a Resend account; verify the sending domain (`mail.<domain>.ai`) — add SPF, DKIM, DMARC DNS records.
2. Set env on Hetzner (the backend `.env`) and Vercel (portal): `RESEND_API_KEY`, `EMAIL_FROM="Steward <notes@mail.<domain>.ai>"`, `EMAIL_ENABLED=true`, `PUBLIC_APP_URL=https://<app-domain>`.
3. Apply migration `0018_email_system.sql` in Supabase.
4. Restart backend agents (`scripts/restart-agents.sh`) so the worker picks up `EMAIL_ENABLED`.
5. Smoke test: sign in with a fresh account → welcome email arrives; connect calendar → calendar_connected arrives.

- [ ] **Step 3: Commit (if any doc file was added)**

```bash
git commit --allow-empty -m "chore(email): foundation + system emails complete"
```

---

## Notes for follow-on plans (Phases 3–5, not in this plan)

- **Post-meeting notes:** enqueue in `meeting_runner` teardown after the summary persists; resolve recipients (per-meeting `notes_recipients` → `email_prefs.notes_recipients` → default `only_me`); `attendees[]` for `everyone`; add `meeting_notes.html`; Settings "Email" section; `manual_share`; unsubscribe route + Resend webhook → `email_suppressions`; `List-Unsubscribe` header for external recipients.
- **Pre-meeting prep:** scheduler enqueues `meeting_prep` at `start − 1h` for recurring meetings (reuse `build_meeting_brief`); `scheduled_for` future-dates the row.
- **Digests & reminders:** nightly cron in the worker builds `digest`/`action_reminder` rows per `email_prefs`.
