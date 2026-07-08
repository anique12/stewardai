"""Tests for calendar auto-join sync (organizer filter, Meet-link, upsert)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from stewardai.scheduler.calendar_sync import (
    _attendee_names,
    _dedup,
    _extract_terms,
    _native_id,
    _rows_and_events,
    sync_calendars_once,
)


def _rows_for_events(user_id, items):
    """Back-compat shim: the old helper returned rows; keep the assertions simple."""
    return [row for row, _ in _rows_and_events(user_id, items)]


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


def test_rows_include_only_organizer_meet_timed():
    events = [
        _ev(),  # kept
        _ev(id="e2", organizer={"self": None}),  # not organizer -> skip
        _ev(id="e3", hangoutLink=None, conferenceData=None),  # no meet -> skip
        _ev(id="e4", start={"date": "2026-07-02"}),  # all-day (no dateTime) -> skip
        _ev(id="e5", organizer={}),  # organizer without self -> skip
    ]
    rows = _rows_for_events("u1", events)
    assert [r["google_event_id"] for r in rows] == ["evt-1"]
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


# --- end-to-end sync with mocks --------------------------------------------


def _mock_client(user_rows, capture):
    client = MagicMock()

    sel = MagicMock()
    sel.eq.return_value = sel
    sel.execute = AsyncMock(return_value=MagicMock(data=user_rows))

    ups = MagicMock()

    async def _ups_exec():
        return MagicMock(data=[{}])

    def _upsert(rows, **kw):
        capture["rows"] = rows
        capture["kw"] = kw
        u = MagicMock()
        u.execute = AsyncMock(side_effect=_ups_exec)
        return u

    def _table(name):
        t = MagicMock()
        t.select.return_value = sel
        t.upsert = _upsert
        return t

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
    assert n == 1
    composio.execute.assert_called_once()
    assert composio.execute.call_args.args[1] == "GOOGLECALENDAR_EVENTS_LIST"
    assert capture["rows"][0]["opted_in"] is True
    assert capture["kw"]["on_conflict"] == "user_id,google_event_id"


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
