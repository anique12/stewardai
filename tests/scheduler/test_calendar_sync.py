"""Tests for calendar auto-join sync (Meet-link filter, auto-join policy, no-clobber upsert)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from stewardai.scheduler.calendar_sync import (
    _attendee_names,
    _attendees,
    _dedup,
    _extract_terms,
    _gravatar_url,
    _native_id,
    _opted_in_for_policy,
    _rows_and_events,
    sync_calendars_once,
)


def _rows_for_events(user_id, items, policy="all"):
    """Back-compat shim: the old helper returned rows; keep the assertions simple."""
    return [row for row, _ in _rows_and_events(user_id, items, policy)]


def _ev(**over):
    e = {
        "id": "evt-1",
        "summary": "Sync",
        "organizer": {"self": True},
        "hangoutLink": "https://meet.google.com/abc-defg-hij",
        "start": {"dateTime": "2026-07-02T12:00:00+05:00"},
    }
    e.update(over)
    return e


# --- pure filter logic -----------------------------------------------------


def test_rows_include_meet_timed_regardless_of_organizer():
    events = [
        _ev(),  # kept — organizer
        _ev(id="e2", organizer={"self": None}),  # kept — non-organizer, policy=all
        _ev(id="e3", hangoutLink=None, conferenceData=None),  # no meet -> skip
        _ev(id="e4", start={"date": "2026-07-02"}),  # all-day (no dateTime) -> skip
        _ev(id="e5", organizer={}),  # organizer without self -> kept, policy=all
    ]
    rows = _rows_for_events("u1", events)
    assert [r["google_event_id"] for r in rows] == ["evt-1", "e2", "e5"]
    r = rows[0]
    assert r["user_id"] == "u1"
    assert r["opted_in"] is True
    assert r["meet_url"] == "https://meet.google.com/abc-defg-hij"
    assert r["native_meeting_id"] == "abc-defg-hij"
    assert r["start_time"] == "2026-07-02T12:00:00+05:00"


def test_rows_use_conference_data_when_no_hangout_link():
    ev = _ev(
        hangoutLink=None,
        conferenceData={
            "entryPoints": [
                {"entryPointType": "more", "uri": "https://x"},
                {"entryPointType": "video", "uri": "https://meet.google.com/xyz-1234-abc"},
            ]
        },
    )
    rows = _rows_for_events("u1", [ev])
    assert rows[0]["meet_url"] == "https://meet.google.com/xyz-1234-abc"
    assert rows[0]["native_meeting_id"] == "xyz-1234-abc"


def test_native_id_parsing():
    assert _native_id("https://meet.google.com/abc-defg-hij") == "abc-defg-hij"
    assert _native_id("https://zoom.us/j/123") is None
    assert _native_id("not a url") is None


def test_rows_carry_recurring_event_id():
    ev = _ev(id="abc_20260702T140000Z", recurringEventId="abc")
    rows = _rows_for_events("u1", [ev])
    assert rows[0]["recurring_event_id"] == "abc"


def test_rows_recurring_event_id_null_for_one_off():
    rows = _rows_for_events("u1", [_ev()])
    assert rows[0]["recurring_event_id"] is None


def test_rows_carry_attendees():
    ev = _ev(
        attendees=[
            {"email": "alice@x.com", "displayName": "Alice Smith", "responseStatus": "accepted"},
            {"email": "room@resource.calendar.google.com", "resource": True},
        ]
    )
    rows = _rows_for_events("u1", [ev])
    attendees = rows[0]["attendees"]
    assert len(attendees) == 1  # resource room skipped
    assert attendees[0]["email"] == "alice@x.com"
    assert attendees[0]["name"] == "Alice Smith"
    assert attendees[0]["photoUrl"] == _gravatar_url("alice@x.com")


def test_gravatar_url_known_hash():
    # md5("test@example.com") = 55502f40dc8b7c769880b10874abc9d0 (verified independently)
    assert _gravatar_url("test@example.com") == (
        "https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?d=404&s=96"
    )
    assert _gravatar_url("  Test@Example.com  ") == _gravatar_url("test@example.com")


def test_attendees_no_attendees_is_empty_list():
    assert _attendees({}) == []
    assert _attendees({"attendees": None}) == []


# --- per-policy opted_in default --------------------------------------------


def test_opted_in_for_policy_all_joins_everyone():
    assert _opted_in_for_policy("all", is_organizer=True) is True
    assert _opted_in_for_policy("all", is_organizer=False) is True


def test_opted_in_for_policy_organizer_only_joins_organizer():
    assert _opted_in_for_policy("organizer", is_organizer=True) is True
    assert _opted_in_for_policy("organizer", is_organizer=False) is False


def test_opted_in_for_policy_none_never_joins():
    assert _opted_in_for_policy("none", is_organizer=True) is False
    assert _opted_in_for_policy("none", is_organizer=False) is False


def test_rows_and_events_apply_organizer_policy():
    events = [_ev(), _ev(id="e2", organizer={"self": None})]
    rows = _rows_for_events("u1", events, policy="organizer")
    by_id = {r["google_event_id"]: r for r in rows}
    assert by_id["evt-1"]["opted_in"] is True
    assert by_id["e2"]["opted_in"] is False


def test_rows_and_events_apply_none_policy():
    rows = _rows_for_events("u1", [_ev()], policy="none")
    assert rows[0]["opted_in"] is False


# --- end-to-end sync with mocks --------------------------------------------


class _FakeBuilder:
    """Minimal chainable stand-in for a postgrest query builder."""

    def __init__(self, data):
        self._data = data

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def in_(self, *a, **k):
        return self

    def maybe_single(self):
        return self

    async def execute(self):
        return MagicMock(data=self._data)


def _mock_client(connected_rows, capture, *, policy="all", existing_event_ids=None):
    """Table-aware fake client: routes select/upsert/update per table name so the
    policy lookup, existing-id lookup, and upsert calls can be asserted independently."""
    existing_event_ids = existing_event_ids or set()
    capture.setdefault("upserts", [])

    def _upsert(rows, **kw):
        capture["upserts"].append({"rows": rows, "kw": kw})
        u = MagicMock()
        u.execute = AsyncMock(return_value=MagicMock(data=[{}]))
        return u

    def _update(*a, **k):
        u = MagicMock()
        u.eq.return_value = u
        u.execute = AsyncMock(return_value=MagicMock(data=[{}]))
        return u

    def _table(name):
        t = MagicMock()
        if name == "connected_apps":
            t.select.return_value = _FakeBuilder(connected_rows)
        elif name == "profiles":
            t.select.return_value = _FakeBuilder({"auto_join_policy": policy})
        elif name == "meetings":
            existing_rows = [{"google_event_id": eid} for eid in existing_event_ids]
            t.select.return_value = _FakeBuilder(existing_rows)
        else:
            t.select.return_value = _FakeBuilder([])
        t.upsert = _upsert
        t.update = _update
        return t

    client = MagicMock()
    client.table.side_effect = _table
    return client


async def test_sync_lists_and_upserts_opted_in():
    capture: dict = {}
    client = _mock_client([{"user_id": "u1"}], capture)
    composio = MagicMock()
    composio.execute.return_value = {
        "successful": True,
        "data": {"items": [_ev(), _ev(id="e2", organizer={"self": None})]},
    }
    n = await sync_calendars_once(client, composio)
    assert n == 2  # policy=all -> both events kept
    composio.execute.assert_called_once()
    assert composio.execute.call_args.args[1] == "GOOGLECALENDAR_EVENTS_LIST"
    new_rows_upsert = next(u for u in capture["upserts"] if u["rows"])
    assert all(r["opted_in"] is True for r in new_rows_upsert["rows"])
    assert new_rows_upsert["kw"]["on_conflict"] == "user_id,google_event_id"


async def test_sync_organizer_policy_filters_non_organizer_opted_in():
    capture: dict = {}
    client = _mock_client([{"user_id": "u1"}], capture, policy="organizer")
    composio = MagicMock()
    composio.execute.return_value = {
        "successful": True,
        "data": {"items": [_ev(), _ev(id="e2", organizer={"self": None})]},
    }
    await sync_calendars_once(client, composio)
    rows = capture["upserts"][0]["rows"]
    by_id = {r["google_event_id"]: r for r in rows}
    assert by_id["evt-1"]["opted_in"] is True
    assert by_id["e2"]["opted_in"] is False


async def test_sync_does_not_clobber_opted_in_on_existing_meeting():
    """CRITICAL: re-syncing a meeting that already exists must never send
    `opted_in` in its upsert row, so a user's manual per-meeting toggle survives."""
    capture: dict = {}
    client = _mock_client([{"user_id": "u1"}], capture, existing_event_ids={"evt-1"})
    composio = MagicMock()
    composio.execute.return_value = {
        "successful": True,
        "data": {"items": [_ev(), _ev(id="e2")]},  # evt-1 already exists, e2 is new
    }
    await sync_calendars_once(client, composio)

    existing_upsert = next(
        u for u in capture["upserts"] if u["rows"][0]["google_event_id"] == "evt-1"
    )
    assert "opted_in" not in existing_upsert["rows"][0]

    new_upsert = next(u for u in capture["upserts"] if u["rows"][0]["google_event_id"] == "e2")
    assert new_upsert["rows"][0]["opted_in"] is True


async def test_sync_no_connected_users_is_noop():
    capture: dict = {}
    client = _mock_client([], capture)
    composio = MagicMock()
    n = await sync_calendars_once(client, composio)
    assert n == 0
    composio.execute.assert_not_called()


# --- keyterms (attendee names + LLM domain terms) --------------------------


def test_attendee_names_skips_self_and_rooms():
    ev = {
        "attendees": [
            {"self": True, "email": "me@x.com"},          # me -> skip
            {"displayName": "Alice Smith", "email": "a@x.com"},
            {"email": "bob.jones@x.com"},                  # no name -> localpart
            {"resource": True, "displayName": "Room A"},   # room -> skip
        ]
    }
    assert _attendee_names(ev) == ["Alice Smith", "bob jones"]


def test_dedup_case_insensitive_preserves_order():
    assert _dedup(["Alice", "alice", "Bob", "  ", "Alice"]) == ["Alice", "Bob"]


async def test_extract_terms_parses_json_array():
    llm = MagicMock()

    def _complete(*a, **k):
        async def _g():
            yield '["Propellus", "Vexa", "Kashmine"]'

        return _g()

    llm.complete.side_effect = _complete
    terms = await _extract_terms(llm, "Sync about Propellus and Vexa with Kashmine")
    assert terms == ["Propellus", "Vexa", "Kashmine"]


async def test_extract_terms_no_llm_or_empty_text():
    assert await _extract_terms(None, "text") == []
    llm = MagicMock()
    assert await _extract_terms(llm, "   ") == []
    llm.complete.assert_not_called()
