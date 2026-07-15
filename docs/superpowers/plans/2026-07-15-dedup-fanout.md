# Dedup-per-Meeting + Fan-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When multiple opted-in MeetBase users are in the same Google Meet, join ONE bot and fan the results (transcript, summary, action items, post-meeting emails) out to every one of them.

**Architecture:** Approach A — fan-out at write time, keep the existing per-user `meetings` rows. The scheduler groups due rows by `native_meeting_id`, picks a lead, and dispatches a single bot. At teardown the runner copies shared artifacts into every sibling row, runs per-user action extraction with each user's own tools, and enqueues a per-user `meeting_notes` email.

**Tech Stack:** Python 3.12, asyncio, Supabase (async client), Composio, Jinja2 (email templates), pytest (asyncio_mode=auto).

**Note:** "bot-on-invite" (adding the bot's email to organizer-owned calendar invites for reliable admission) is described in the spec but is **deferred** — not part of this plan.

## Global Constraints

- Dedup grouping key = `native_meeting_id`, falling back to `calendar_sync._native_id(meet_url)` when the column is null. Never group on `meetings.id` (per-user) or raw `meet_url` equality.
- Never write the integer Vexa meeting id into the UUID `vexa_meeting_id` column.
- Every new Supabase read/write is best-effort and fully guarded — a fan-out or grouping failure must never break a live meeting or the scheduler loop.
- Authenticated join is retained; `bot_name` stays inert for the displayed name (do not attempt per-user display names).
- Reuse existing modules: `email/outbox.enqueue`, `email/keys.dedup_key_for`, `agent/persistence.persist_meeting_artifacts`, `agent/actions.{AgentActionsWriter,extract_post_meeting_actions}`. No new email/persistence infrastructure.
- Lead selection is a fixed, total order: organizer → most attendees → earliest `created_at` → smallest `id`. Organizer is derived from the row's stored `attendees` (the entry with `self=true` and `organizer=true`) — do NOT add a new column and do NOT add any calendar scope.
- The email brand color is `#2c6b58`; email templates extend `base.html` and define a `subject` block + `content` block (see existing `calendar_connected.html`).
- Live in-meeting behavior stays driven by the single resolved lead user; only post-meeting persistence fans out.
- Tests use bare `async def test_...` (no `@pytest.mark.anyio`) — the project runs pytest with `asyncio_mode = "auto"`.

---

### Task 1: Migration 0019 — dedup schema

**Files:**
- Create: `portal/supabase/migrations/0019_meeting_dedup.sql`
- Test: `tests/scheduler/test_dedup_migration.py`

**Interfaces:**
- Produces: the `'grouped'` `bot_status` value, `meetings.bot_lead_meeting_id uuid`, and index `meetings_native_status_idx`, consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

```python
# tests/scheduler/test_dedup_migration.py
"""Guard test: the dedup migration declares the schema later tasks depend on.
No DB runs in CI, so we assert on the migration SQL text."""
from pathlib import Path

_SQL = (
    Path(__file__).resolve().parents[2]
    / "portal/supabase/migrations/0019_meeting_dedup.sql"
).read_text()


def test_bot_status_check_includes_grouped():
    for status in ("pending", "joining", "in_meeting", "done", "failed", "grouped"):
        assert f"'{status}'" in _SQL, status


def test_adds_bot_lead_meeting_id_self_ref():
    assert "bot_lead_meeting_id" in _SQL
    assert "references public.meetings(id)" in _SQL
    assert "on delete set null" in _SQL


def test_adds_native_status_index():
    assert "meetings_native_status_idx" in _SQL
    assert "native_meeting_id" in _SQL
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/scheduler/test_dedup_migration.py -v`
Expected: FAIL — `FileNotFoundError` (migration does not exist yet).

- [ ] **Step 3: Write the migration**

```sql
-- portal/supabase/migrations/0019_meeting_dedup.sql
-- Dedup-per-meeting + fan-out: one bot per native_meeting_id.
-- 'grouped' = a sibling row whose bot is driven by the lead row (see
-- bot_lead_meeting_id); the scheduler must not dispatch its own bot. Fan-out
-- resolves grouped rows to 'done'/'failed' at teardown.

alter table public.meetings
  drop constraint if exists meetings_bot_status_check;

alter table public.meetings
  add constraint meetings_bot_status_check
  check (bot_status in ('pending','joining','in_meeting','done','failed','grouped'));

alter table public.meetings
  add column if not exists bot_lead_meeting_id uuid
    references public.meetings(id) on delete set null;

create index if not exists meetings_native_status_idx
  on public.meetings (native_meeting_id, bot_status);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/scheduler/test_dedup_migration.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/supabase/migrations/0019_meeting_dedup.sql tests/scheduler/test_dedup_migration.py
git commit -m "feat(db): migration 0019 dedup schema (grouped status, bot_lead_meeting_id, index)"
```

---

### Task 2: `meeting_notes` email template + `enqueue_meeting_notes`

**Files:**
- Create: `src/stewardai/email/templates/meeting_notes.html`
- Modify: `src/stewardai/email/outbox.py` (add `enqueue_meeting_notes`)
- Test: `tests/email/test_meeting_notes_enqueue.py`, `tests/email/test_templates.py`

**Interfaces:**
- Consumes: `enqueue`, `resolve_owner_email` (outbox.py), `dedup_key_for` (keys.py), `render` (templates.py).
- Produces: `async def enqueue_meeting_notes(client, settings, *, user_id: str, meeting_id: str, to_email: str, title: str | None, shared: bool = False) -> bool` — enqueues one `meeting_notes` outbox row, dedup-keyed on `(meeting_id, to_email)`. Consumed by Task 5's `fanout_notes_emails`.

- [ ] **Step 1: Write the failing test**

```python
# tests/email/test_meeting_notes_enqueue.py
from unittest.mock import AsyncMock, MagicMock
from stewardai.email import outbox


def _client():
    client = MagicMock()
    insert_chain = MagicMock()
    insert_chain.execute = AsyncMock(return_value=MagicMock(data=[{}]))
    table = MagicMock()
    table.insert.return_value = insert_chain
    client.table.return_value = table
    return client, insert_chain


def _settings(enabled=True):
    s = MagicMock()
    s.email_enabled = enabled
    return s


async def test_enqueue_meeting_notes_inserts_dedup_keyed_row():
    client, _ = _client()
    ok = await outbox.enqueue_meeting_notes(
        client, _settings(True),
        user_id="u-1", meeting_id="m-1", to_email="u@x.com", title="Standup",
    )
    assert ok is True
    payload = client.table.return_value.insert.call_args.args[0]
    assert payload["kind"] == "meeting_notes"
    assert payload["to_email"] == "u@x.com"
    assert payload["dedup_key"] == "meeting_notes:m-1:u@x.com"
    assert payload["meeting_id"] == "m-1"


async def test_enqueue_meeting_notes_noop_when_disabled():
    client, _ = _client()
    ok = await outbox.enqueue_meeting_notes(
        client, _settings(False),
        user_id="u-1", meeting_id="m-1", to_email="u@x.com", title="Standup",
    )
    assert ok is False
    client.table.return_value.insert.assert_not_called()
```

Add to `tests/email/test_templates.py`:

```python
def test_meeting_notes_template_renders_subject_and_body():
    from stewardai.email.templates import render
    subject, html = render(
        "meeting_notes",
        {"title": "Weekly Sync", "app_url": "https://app.example"},
    )
    assert "Weekly Sync" in subject
    assert "https://app.example/app/meetings" in html
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/email/test_meeting_notes_enqueue.py tests/email/test_templates.py -k meeting_notes -v`
Expected: FAIL — `AttributeError: ... 'enqueue_meeting_notes'` and `KeyError: no email template for kind=meeting_notes`.

- [ ] **Step 3: Create the template**

```html
<!-- src/stewardai/email/templates/meeting_notes.html -->
{% extends "base.html" %}
{% block subject %}Your notes for {{ title or "your meeting" }}{% endblock %}
{% block content %}
  <p>Hi {{ name or "there" }},</p>
  {% if shared %}
    <p>Notes from <strong>{{ title or "a meeting" }}</strong> were shared with you.</p>
  {% else %}
    <p>Your notes for <strong>{{ title or "your meeting" }}</strong> are ready.</p>
  {% endif %}
  <p><a href="{{ app_url }}/app/meetings" style="color:#2c6b58;font-weight:600">View notes &amp; action items →</a></p>
{% endblock %}
```

- [ ] **Step 4: Add `enqueue_meeting_notes`**

Append to `src/stewardai/email/outbox.py`:

```python
async def enqueue_meeting_notes(
    client,  # noqa: ANN001
    settings,  # noqa: ANN001
    *,
    user_id: str,
    meeting_id: str,
    to_email: str,
    title: str | None,
    shared: bool = False,
) -> bool:
    """Enqueue one post-meeting notes email. dedup_key is (meeting_id, to_email)
    so each recipient is emailed once per meeting even across teardown re-runs.
    Best-effort; honors settings.email_enabled."""
    from stewardai.email.keys import dedup_key_for

    if not to_email:
        return False
    return await enqueue(
        client,
        user_id=user_id,
        kind="meeting_notes",
        to_email=to_email,
        dedup_key=dedup_key_for("meeting_notes", meeting_id=meeting_id, to_email=to_email),
        meeting_id=meeting_id,
        payload={"title": title, "shared": shared},
        enabled=getattr(settings, "email_enabled", False),
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/email/test_meeting_notes_enqueue.py tests/email/test_templates.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stewardai/email/templates/meeting_notes.html src/stewardai/email/outbox.py tests/email/test_meeting_notes_enqueue.py tests/email/test_templates.py
git commit -m "feat(email): meeting_notes template + enqueue_meeting_notes"
```

---

### Task 3: Scheduler grouping + lead-selection helpers

**Files:**
- Modify: `src/stewardai/scheduler/meeting_scheduler.py` (add pure helpers near the top, after `BOT_NAME`/`ALONE_LEAVE_MS`)
- Test: `tests/scheduler/test_meeting_grouping.py`

**Interfaces:**
- Consumes: `calendar_sync._native_id`.
- Produces (all in `meeting_scheduler`):
  - `_group_key(meeting: dict) -> str | None`
  - `_partition_due(meetings: list[dict]) -> tuple[list[list[dict]], list[dict]]` returning `(groups, singletons)`; each group is a list sharing a non-null key, singletons have no key.
  - `_is_organizer(meeting: dict) -> bool`
  - `_pick_lead(group: list[dict]) -> dict`
  Consumed by Task 4's dispatch logic.

- [ ] **Step 1: Write the failing test**

```python
# tests/scheduler/test_meeting_grouping.py
from stewardai.scheduler import meeting_scheduler as ms


def _m(id, native=None, url=None, attendees=None, created=None):
    return {
        "id": id,
        "user_id": f"u-{id}",
        "meet_url": url,
        "native_meeting_id": native,
        "attendees": attendees or [],
        "created_at": created,
    }


def test_group_key_prefers_native_then_derives_from_url():
    assert ms._group_key(_m("a", native="abc")) == "abc"
    assert ms._group_key(_m("b", url="https://meet.google.com/xyz-defg-hij")) == "xyz-defg-hij"
    assert ms._group_key(_m("c")) is None


def test_partition_groups_shared_key_and_isolates_keyless():
    rows = [
        _m("1", native="abc"),
        _m("2", url="https://meet.google.com/abc"),  # same key as #1 via url
        _m("3", native="zzz"),
        _m("4"),  # keyless singleton
    ]
    groups, singletons = ms._partition_due(rows)
    keyed = {tuple(sorted(m["id"] for m in g)) for g in groups}
    assert ("1", "2") in keyed
    assert ("3",) in keyed
    assert [m["id"] for m in singletons] == ["4"]


def test_is_organizer_reads_self_organizer_attendee():
    org = _m("1", attendees=[{"self": True, "organizer": True}])
    non = _m("2", attendees=[{"self": True, "organizer": False}])
    assert ms._is_organizer(org) is True
    assert ms._is_organizer(non) is False


def test_pick_lead_prefers_organizer_then_attendee_count_then_created():
    organizer = _m("1", native="k", attendees=[{"self": True, "organizer": True}], created="2026-01-02")
    most = _m("2", native="k", attendees=[{}, {}, {}], created="2026-01-01")
    assert ms._pick_lead([most, organizer])["id"] == "1"  # organizer wins

    a = _m("3", native="k", attendees=[{}, {}], created="2026-01-02")
    b = _m("4", native="k", attendees=[{}], created="2026-01-01")
    assert ms._pick_lead([b, a])["id"] == "3"  # more attendees wins (no organizer)

    e1 = _m("5", native="k", attendees=[{}], created="2026-01-01")
    e2 = _m("6", native="k", attendees=[{}], created="2026-01-02")
    assert ms._pick_lead([e2, e1])["id"] == "5"  # earliest created wins on tie
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/scheduler/test_meeting_grouping.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_group_key'`.

- [ ] **Step 3: Add the helpers**

In `src/stewardai/scheduler/meeting_scheduler.py`, after the `BOT_NAME` / `ALONE_LEAVE_MS` constants:

```python
from stewardai.scheduler.calendar_sync import _native_id


def _group_key(meeting: dict) -> str | None:
    """Dedup key for a due row: stored native_meeting_id, else derived from the
    meet_url (instant-join rows may not have the column populated yet)."""
    return meeting.get("native_meeting_id") or _native_id(meeting.get("meet_url") or "")


def _partition_due(meetings: list[dict]) -> tuple[list[list[dict]], list[dict]]:
    """Split due rows into (groups, singletons). Rows sharing a non-null
    _group_key form one group (one bot for all of them); rows with no key are
    dispatched individually as before."""
    by_key: dict[str, list[dict]] = {}
    singletons: list[dict] = []
    for m in meetings:
        key = _group_key(m)
        if key:
            by_key.setdefault(key, []).append(m)
        else:
            singletons.append(m)
    return list(by_key.values()), singletons


def _is_organizer(meeting: dict) -> bool:
    """True if the row's owner organizes the event (its own attendee entry is
    marked self+organizer). Derived from stored attendees — no extra column."""
    for a in meeting.get("attendees") or []:
        if isinstance(a, dict) and a.get("self") and a.get("organizer"):
            return True
    return False


def _pick_lead(group: list[dict]) -> dict:
    """Choose the row whose bot joins: organizer → most attendees → earliest
    created_at → smallest id. Total order, so selection is deterministic."""
    return sorted(
        group,
        key=lambda r: (
            not _is_organizer(r),               # organizers first
            -len(r.get("attendees") or []),     # then most attendees
            str(r.get("created_at") or ""),     # then earliest created
            str(r.get("id") or ""),             # tie-break: smallest id
        ),
    )[0]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/scheduler/test_meeting_grouping.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/scheduler/meeting_scheduler.py tests/scheduler/test_meeting_grouping.py
git commit -m "feat(scheduler): meeting grouping + lead-selection helpers"
```

---

### Task 4: Dedup dispatch (`dispatch_meeting` returns bool, `dispatch_group`, `run_once`)

**Files:**
- Modify: `src/stewardai/scheduler/meeting_scheduler.py` (`get_due_meetings` select; `dispatch_meeting` return value; new `dispatch_group`; `run_once`)
- Test: `tests/scheduler/test_meeting_scheduler.py` (add dedup tests; keep existing green)

**Interfaces:**
- Consumes: `_partition_due`, `_pick_lead`, `dispatch_meeting`, `spawn_bot`, `_bot_name_for` (Task 3 + existing).
- Produces: `async def dispatch_meeting(...) -> bool` (True on success) and `async def dispatch_group(client, settings, group: list[dict]) -> None`.

- [ ] **Step 1: Write the failing tests**

```python
# add to tests/scheduler/test_meeting_scheduler.py
async def test_dispatch_meeting_returns_true_on_success():
    client, _ = _mock_client()
    with patch.object(ms, "spawn_bot", AsyncMock(return_value={"id": 1, "native_meeting_id": "n"})):
        assert await ms.dispatch_meeting(client, _settings(), _meeting()) is True


async def test_dispatch_meeting_returns_false_on_failure():
    client, _ = _mock_client()
    with patch.object(ms, "spawn_bot", AsyncMock(side_effect=RuntimeError("boom"))):
        assert await ms.dispatch_meeting(client, _settings(), _meeting()) is False


async def test_run_once_dedups_same_native_meeting_to_one_bot():
    rows = [
        _meeting(id="m-1", user_id="u-1", native_meeting_id="abc",
                 attendees=[{"self": True, "organizer": True}]),
        _meeting(id="m-2", user_id="u-2", native_meeting_id="abc", attendees=[{}]),
        _meeting(id="m-3", user_id="u-3", native_meeting_id="zzz", attendees=[{}]),
    ]
    client, _ = _mock_client(rows)
    with patch.object(
        ms, "spawn_bot", AsyncMock(return_value={"id": 1, "native_meeting_id": "abc"})
    ) as spawn:
        await ms.run_once(client, _settings())

    # One bot for the 'abc' group (lead = organizer m-1) + one for the 'zzz' group.
    assert spawn.await_count == 2
    payloads = _update_payloads(client)
    # m-2 marked 'grouped' pointing at the lead m-1.
    assert any(
        p.get("bot_status") == "grouped" and p.get("bot_lead_meeting_id") == "m-1"
        for p in payloads
    ), payloads
    # exactly one 'joining' per group (2 groups) -> 2 joining writes.
    assert sum(1 for p in payloads if p.get("bot_status") == "joining") == 2


async def test_run_once_group_lead_failure_leaves_followers_pending():
    rows = [
        _meeting(id="m-1", user_id="u-1", native_meeting_id="abc", attendees=[{"self": True, "organizer": True}]),
        _meeting(id="m-2", user_id="u-2", native_meeting_id="abc", attendees=[{}]),
    ]
    client, _ = _mock_client(rows)
    with patch.object(ms, "spawn_bot", AsyncMock(side_effect=RuntimeError("gateway"))):
        await ms.run_once(client, _settings())
    payloads = _update_payloads(client)
    # Lead marked failed; NO follower marked 'grouped' (retry next poll).
    assert any(p.get("bot_status") == "failed" for p in payloads), payloads
    assert not any(p.get("bot_status") == "grouped" for p in payloads), payloads
```

Update the `_meeting` helper default to include the new selected fields (so existing tests still construct valid rows):

```python
def _meeting(**over):
    row = {
        "id": "m-1",
        "user_id": "u-1",
        "meet_url": "https://meet.google.com/abc-defg-hij",
        "native_meeting_id": None,
        "opted_in": True,
        "bot_status": "pending",
        "start_time": datetime.now(UTC).isoformat(),
        "attendees": [],
        "created_at": datetime.now(UTC).isoformat(),
    }
    row.update(over)
    return row
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/scheduler/test_meeting_scheduler.py -v`
Expected: FAIL — `dispatch_meeting` returns `None`; `run_once` still dispatches per-row (no grouping / no 'grouped' writes).

- [ ] **Step 3: Implement**

In `get_due_meetings`, extend the select to include the fields grouping/lead need:

```python
        .select(
            "id, user_id, meet_url, native_meeting_id, opted_in, bot_status, "
            "start_time, title, attendees, created_at"
        )
```

Make `dispatch_meeting` return `bool` — add `return True` at the end of the success path (after `_log.info("meeting_dispatched", ...)`) and `return False` at the end of the `except Exception` block (after the best-effort failure marking + email enqueue).

Add `dispatch_group`:

```python
async def dispatch_group(client, settings, group: list[dict]) -> None:  # noqa: ANN001
    """Dispatch ONE bot for a group of due rows sharing a native meeting.

    Picks the lead, spawns one bot for it, and — only if that succeeds — marks
    the other rows 'grouped' (pointing at the lead) so later polls never
    re-dispatch them. If the lead fails, followers stay 'pending' to be retried
    (a new lead may be chosen) on the next cycle.
    """
    lead = _pick_lead(group)
    followers = [m for m in group if m.get("id") != lead.get("id")]

    ok = await dispatch_meeting(client, settings, lead)
    if not ok:
        return
    for f in followers:
        with contextlib.suppress(Exception):
            await (
                client.table("meetings")
                .update({"bot_status": "grouped", "bot_lead_meeting_id": lead["id"]})
                .eq("id", f["id"])
                .execute()
            )
    if followers:
        _log.info(
            "meeting_group_dispatched",
            lead_id=lead["id"],
            followers=len(followers),
            native=_group_key(lead),
        )
```

Rewrite `run_once`:

```python
async def run_once(client: AsyncClient, settings: Settings) -> None:
    """One scheduler cycle: dedup due rows by native meeting, dispatch one bot
    per group (+ one per keyless singleton)."""
    meetings = await get_due_meetings(client)
    if not meetings:
        return

    groups, singletons = _partition_due(meetings)
    _log.info("scheduler_dispatching", groups=len(groups), singletons=len(singletons))
    for meeting in singletons:
        await dispatch_meeting(client, settings, meeting)
    for group in groups:
        await dispatch_group(client, settings, group)
```

- [ ] **Step 4: Run the full scheduler test file**

Run: `pytest tests/scheduler/test_meeting_scheduler.py -v`
Expected: PASS — new dedup tests pass AND the pre-existing tests (`test_run_once_dispatches_a_bot_for_every_due_meeting`, `test_run_once_calls_gateway_for_each_meeting_end_to_end`, etc.) still pass, because their rows have `native_meeting_id=None` and route through the singleton path.

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/scheduler/meeting_scheduler.py tests/scheduler/test_meeting_scheduler.py
git commit -m "feat(scheduler): dedup dispatch — one bot per native meeting group"
```

---

### Task 5: Fan-out module

**Files:**
- Create: `src/stewardai/agent/fanout.py`
- Test: `tests/agent/test_fanout.py`

**Interfaces:**
- Consumes: `persist_meeting_artifacts` (persistence.py), `AgentActionsWriter` + `extract_post_meeting_actions` (actions.py), `enqueue_meeting_notes` + `resolve_owner_email` (outbox.py — Task 2).
- Produces (all in `stewardai.agent.fanout`):
  - `async def resolve_group_meetings(client, native_meeting_id: str) -> list[dict]` — opted-in rows for the native id whose bot participated (`bot_status in {joining,in_meeting,grouped,done}`), each dict has `id, user_id, title, notes_recipients, attendees`.
  - `async def fanout_shared_artifacts(client, siblings: list[dict], transcript: list[str], summary: dict) -> None`
  - `async def fanout_per_user_actions(llm, composio, client, siblings: list[dict], transcript: list[str], *, default_timezone: str = "UTC") -> None`
  - `async def fanout_notes_emails(client, settings, group: list[dict]) -> None`
  Consumed by Task 6 (runner teardown).

- [ ] **Step 1: Write the failing test**

```python
# tests/agent/test_fanout.py
from unittest.mock import AsyncMock, MagicMock, patch
from stewardai.agent import fanout


def _client(rows=None):
    client = MagicMock()
    sel = MagicMock()
    sel.execute = AsyncMock(return_value=MagicMock(data=rows or []))
    sel.eq.return_value = sel
    upd = MagicMock()
    upd.execute = AsyncMock(return_value=MagicMock(data=[{}]))
    upd.eq.return_value = upd
    table = MagicMock()
    table.select.return_value = sel
    table.update.return_value = upd
    client.table.return_value = table
    return client


async def test_resolve_group_meetings_filters_by_status():
    rows = [
        {"id": "m-1", "user_id": "u-1", "bot_status": "in_meeting"},
        {"id": "m-2", "user_id": "u-2", "bot_status": "grouped"},
        {"id": "m-3", "user_id": "u-3", "bot_status": "pending"},   # excluded
        {"id": "m-4", "user_id": "u-4", "bot_status": "failed"},    # excluded
    ]
    client = _client(rows)
    out = await fanout.resolve_group_meetings(client, "abc")
    assert sorted(m["id"] for m in out) == ["m-1", "m-2"]


async def test_fanout_shared_artifacts_persists_each_and_marks_done():
    client = _client()
    siblings = [{"id": "m-2", "user_id": "u-2"}, {"id": "m-3", "user_id": "u-3"}]
    with patch.object(fanout, "persist_meeting_artifacts", AsyncMock()) as persist:
        await fanout.fanout_shared_artifacts(client, siblings, ["[A]: hi"], {"tldr": "x"})
    assert persist.await_count == 2
    assert {c.args[1] for c in persist.await_args_list} == {"m-2", "m-3"}


async def test_fanout_per_user_actions_runs_extraction_per_user():
    client = _client()
    siblings = [{"id": "m-2", "user_id": "u-2"}, {"id": "m-3", "user_id": None}]
    with patch.object(fanout, "extract_post_meeting_actions", AsyncMock(return_value=1)) as ex, \
         patch.object(fanout, "AgentActionsWriter", MagicMock()):
        await fanout.fanout_per_user_actions(MagicMock(), MagicMock(), client, siblings, ["t"])
    # Only the sibling with a user_id runs (m-3 skipped: no user_id).
    assert ex.await_count == 1
    assert ex.await_args.kwargs["user_id"] == "u-2"
    assert ex.await_args.kwargs["meeting_id"] == "m-2"


async def test_fanout_notes_emails_enqueues_owner_per_meeting():
    client = _client()
    group = [
        {"id": "m-1", "user_id": "u-1", "title": "Sync", "notes_recipients": "only_me", "attendees": []},
        {"id": "m-2", "user_id": "u-2", "title": "Sync", "notes_recipients": "only_me", "attendees": []},
    ]
    settings = MagicMock(email_enabled=True)
    with patch.object(fanout, "resolve_owner_email", AsyncMock(return_value="o@x.com")), \
         patch.object(fanout, "enqueue_meeting_notes", AsyncMock(return_value=True)) as enq:
        await fanout.fanout_notes_emails(client, settings, group)
    assert enq.await_count == 2
    assert {c.kwargs["meeting_id"] for c in enq.await_args_list} == {"m-1", "m-2"}


async def test_fanout_notes_emails_everyone_also_enqueues_attendees():
    client = _client()
    group = [{
        "id": "m-1", "user_id": "u-1", "title": "Sync", "notes_recipients": "everyone",
        "attendees": [{"email": "guest@x.com", "self": False}, {"email": "me@x.com", "self": True}],
    }]
    settings = MagicMock(email_enabled=True)
    with patch.object(fanout, "resolve_owner_email", AsyncMock(return_value="o@x.com")), \
         patch.object(fanout, "enqueue_meeting_notes", AsyncMock(return_value=True)) as enq:
        await fanout.fanout_notes_emails(client, settings, group)
    tos = {c.kwargs["to_email"] for c in enq.await_args_list}
    # owner + non-self attendee; the self attendee is not double-sent.
    assert "o@x.com" in tos and "guest@x.com" in tos and "me@x.com" not in tos
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/agent/test_fanout.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stewardai.agent.fanout'`.

- [ ] **Step 3: Implement the module**

```python
# src/stewardai/agent/fanout.py
"""Fan a single bot's results out to every opted-in MeetBase user in the same
call (dedup-per-meeting + fan-out). One bot runs for the lead; at teardown the
shared artifacts are copied to each sibling row, per-user action extraction runs
with each user's own tools, and a per-user notes email is enqueued.

Every function is best-effort and guarded — a failure for one sibling never
affects the others or the lead's own teardown.
"""
from __future__ import annotations

import contextlib
from typing import Any

from stewardai.agent.actions import AgentActionsWriter, extract_post_meeting_actions
from stewardai.agent.persistence import persist_meeting_artifacts
from stewardai.common.logging import get_logger
from stewardai.email.outbox import enqueue_meeting_notes, resolve_owner_email

_log = get_logger("agent.fanout")

# Rows whose bot actually participated in this call (so fan-out applies).
_PARTICIPATED = {"joining", "in_meeting", "grouped", "done"}


async def resolve_group_meetings(client, native_meeting_id: str) -> list[dict]:  # noqa: ANN001
    """All opted-in rows sharing this native_meeting_id whose bot participated."""
    try:
        resp = await (
            client.table("meetings")
            .select("id, user_id, title, notes_recipients, attendees, bot_status")
            .eq("native_meeting_id", native_meeting_id)
            .eq("opted_in", True)
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if r.get("bot_status") in _PARTICIPATED]
    except Exception as exc:  # noqa: BLE001
        _log.warning("fanout_resolve_failed", native=native_meeting_id, error=str(exc))
        return []


async def fanout_shared_artifacts(
    client, siblings: list[dict], transcript: list[str], summary: dict  # noqa: ANN001
) -> None:
    """Write the shared transcript + summary to each sibling row and mark done."""
    for s in siblings:
        mid = s.get("id")
        if not mid:
            continue
        with contextlib.suppress(Exception):
            await persist_meeting_artifacts(client, mid, transcript, summary)
        with contextlib.suppress(Exception):
            await client.table("meetings").update({"bot_status": "done"}).eq("id", mid).execute()


async def fanout_per_user_actions(
    llm: Any,
    composio: Any,
    client,  # noqa: ANN001
    siblings: list[dict],
    transcript: list[str],
    *,
    default_timezone: str = "UTC",
) -> None:
    """Run post-meeting action extraction once per sibling user, with THAT user's
    connected tools, writing agent_actions on that user's meeting_id."""
    for s in siblings:
        mid, uid = s.get("id"), s.get("user_id")
        if not mid or not uid:
            continue
        with contextlib.suppress(Exception):
            writer = AgentActionsWriter(meeting_id=mid, user_id=uid, client=client)
            await extract_post_meeting_actions(
                llm,
                transcript,
                user_id=uid,
                meeting_id=mid,
                composio_service=composio,
                writer=writer,
                default_timezone=default_timezone,
            )


async def fanout_notes_emails(client, settings, group: list[dict]) -> None:  # noqa: ANN001
    """Enqueue a meeting_notes email per user in the group (owner-only by default;
    also to non-self attendees when that user's notes_recipients is 'everyone')."""
    for m in group:
        mid, uid = m.get("id"), m.get("user_id")
        if not mid or not uid:
            continue
        title = m.get("title")
        owner_email = await resolve_owner_email(client, uid)
        if owner_email:
            with contextlib.suppress(Exception):
                await enqueue_meeting_notes(
                    client, settings, user_id=uid, meeting_id=mid,
                    to_email=owner_email, title=title, shared=False,
                )
        if (m.get("notes_recipients") or "only_me") == "everyone":
            for a in m.get("attendees") or []:
                if not isinstance(a, dict) or a.get("self"):
                    continue
                ae = (a.get("email") or "").strip()
                if not ae:
                    continue
                with contextlib.suppress(Exception):
                    await enqueue_meeting_notes(
                        client, settings, user_id=uid, meeting_id=mid,
                        to_email=ae, title=title, shared=True,
                    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/agent/test_fanout.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/fanout.py tests/agent/test_fanout.py
git commit -m "feat(agent): fan-out module (shared artifacts + per-user actions + notes emails)"
```

---

### Task 6: Wire fan-out into runner teardown

**Files:**
- Modify: `src/stewardai/agent/meeting_runner.py` (`__init__` stash `self._last_summary`; `_write_summary` set it; `teardown` call fan-out)
- Test: `tests/agent/test_runner_fanout_wiring.py`

**Interfaces:**
- Consumes: `stewardai.agent.fanout.{resolve_group_meetings,fanout_shared_artifacts,fanout_per_user_actions,fanout_notes_emails}` (Task 5).
- The lead's OWN artifacts + extraction already run in the existing teardown; fan-out targets only the FOLLOWERS (rows other than `self._meeting_uuid`) for artifacts + actions, and ALL group rows for notes emails (dedup-keyed, so the lead is emailed exactly once).

- [ ] **Step 1: Write the failing test**

The teardown is large; test the extracted module-level helper `_fanout_results` in isolation rather than instantiating a full session.

```python
# tests/agent/test_runner_fanout_wiring.py
from unittest.mock import AsyncMock, MagicMock, patch
from stewardai.agent import meeting_runner as mr


class _Sess:
    """Minimal stand-in exposing just what _fanout_results reads."""
    def __init__(self):
        self._supabase = MagicMock()
        self._llm = MagicMock()
        self._composio = MagicMock()
        self._s = MagicMock(email_enabled=True)
        self.native_meeting_id = "abc"
        self._meeting_uuid = "m-1"          # the lead
        self._last_summary = {"tldr": "x"}
        self._user_timezone = "UTC"


async def test_fanout_results_targets_followers_and_all_for_email():
    sess = _Sess()
    group = [
        {"id": "m-1", "user_id": "u-1"},  # lead
        {"id": "m-2", "user_id": "u-2"},  # follower
    ]
    with patch.object(mr, "_fanout_mod") as mod:
        mod.resolve_group_meetings = AsyncMock(return_value=group)
        mod.fanout_shared_artifacts = AsyncMock()
        mod.fanout_per_user_actions = AsyncMock()
        mod.fanout_notes_emails = AsyncMock()
        await mr._fanout_results(sess, ["[A]: hi"])

    # Followers only (excludes the lead m-1) for artifacts + actions.
    followers = mod.fanout_shared_artifacts.await_args.args[1]
    assert [m["id"] for m in followers] == ["m-2"]
    mod.fanout_per_user_actions.assert_awaited_once()
    # Emails for the WHOLE group (lead + follower).
    emailed = mod.fanout_notes_emails.await_args.args[2]
    assert [m["id"] for m in emailed] == ["m-1", "m-2"]


async def test_fanout_results_noop_without_summary():
    sess = _Sess()
    sess._last_summary = None
    with patch.object(mr, "_fanout_mod") as mod:
        mod.resolve_group_meetings = AsyncMock(return_value=[])
        await mr._fanout_results(sess, ["t"])
    mod.resolve_group_meetings.assert_not_awaited()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/agent/test_runner_fanout_wiring.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_fanout_mod'` / `_fanout_results`.

- [ ] **Step 3: Implement**

At the top of `src/stewardai/agent/meeting_runner.py`, add a module import alias (kept as a module handle so tests can patch it). If this surfaces a circular import at collection time, that means `fanout`'s imports chain back to `meeting_runner`; resolve it by importing the specific leaf functions instead — but `fanout` only imports `actions`, `persistence`, `outbox`, `common.logging`, none of which import `meeting_runner`, so the module import is expected to be safe:

```python
from stewardai.agent import fanout as _fanout_mod
```

Add a module-level function (near the other module helpers, e.g. after `_resolve_user_id`):

```python
async def _fanout_results(session, transcript: list[str]) -> None:  # noqa: ANN001
    """Fan the lead bot's results out to every other opted-in MeetBase user in
    the same call. Best-effort; the lead's own artifacts/extraction already ran
    in teardown, so followers get artifacts + per-user actions and the whole
    group gets a (dedup-keyed) notes email."""
    if (
        session._supabase is None
        or not session.native_meeting_id
        or session._last_summary is None
    ):
        return
    group = await _fanout_mod.resolve_group_meetings(
        session._supabase, session.native_meeting_id
    )
    if not group:
        return
    followers = [m for m in group if m.get("id") != session._meeting_uuid]
    if followers:
        await _fanout_mod.fanout_shared_artifacts(
            session._supabase, followers, transcript, session._last_summary
        )
        if session._composio is not None:
            await _fanout_mod.fanout_per_user_actions(
                session._llm,
                session._composio,
                session._supabase,
                followers,
                transcript,
                default_timezone=session._user_timezone,
            )
    await _fanout_mod.fanout_notes_emails(session._supabase, session._s, group)
```

In `__init__`, initialize the summary stash (near `self._meeting_uuid = None`, ~line 171):

```python
        self._last_summary: dict | None = None
```

In `_write_summary` (inside `build`), right after `summary = await asyncio.wait_for(generate_summary(...), ...)`, stash it:

```python
                    self._last_summary = summary
```

In `teardown`, after the existing post-meeting action extraction block (after `_log.info("post_meeting_actions_extracted", ...)`) and before the KB ingestion block, add:

```python
        # Fan the results out to every OTHER opted-in MeetBase user in this same
        # call (dedup-per-meeting: one bot, many owners). Guarded — never blocks
        # the rest of teardown.
        with contextlib.suppress(Exception):
            await asyncio.wait_for(_fanout_results(self, teardown_transcript), timeout=30.0)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/agent/test_runner_fanout_wiring.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the agent test suite to confirm no regressions**

Run: `pytest tests/agent -q`
Expected: PASS (all existing agent tests + the new wiring tests).

- [ ] **Step 6: Commit**

```bash
git add src/stewardai/agent/meeting_runner.py tests/agent/test_runner_fanout_wiring.py
git commit -m "feat(agent): wire dedup fan-out into runner teardown"
```

---

## Post-implementation notes

- **Deploy:** apply migration `0019` to Supabase. `EMAIL_ENABLED` still gates all sends; the `meeting_notes` email will not send until it's on.
- **Known limitation (documented):** live in-meeting speech is driven by the lead user only; non-leads get shared notes + their own actions/emails. Cross-meeting concurrency (multiple simultaneous different meetings) and bot-on-invite reliability both remain for separate future specs.
