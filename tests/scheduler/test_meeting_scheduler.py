"""Tests for the meeting scheduler (bot dispatch, multiplexer model).

The scheduler no longer spawns per-meeting agents or holds a single-meeting slot:
one long-lived multiplexer serves every meeting, so each cycle just dispatches a
Vexa bot for EVERY due meeting. Everything external is mocked: the Supabase async
client chain and the Vexa gateway (via spawn_bot / httpx).
"""
from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from stewardai.scheduler import meeting_scheduler as ms


def _mock_client(rows=None):
    """Mock async Supabase client.

    select chain: .table().select().eq().eq().gte().lte().execute()
    update chain: .table().update().eq().execute()
    A single shared select-chain mock lets every filter (.eq/.gte/.lte) chain
    back to itself; update payloads are captured via table.update.call_args_list.
    """
    client = MagicMock()

    select_execute = AsyncMock(return_value=MagicMock(data=rows or []))
    select_chain = MagicMock()
    select_chain.execute = select_execute
    select_chain.eq.return_value = select_chain
    select_chain.gte.return_value = select_chain
    select_chain.lte.return_value = select_chain

    update_execute = AsyncMock(return_value=MagicMock(data=[{}]))
    update_eq_chain = MagicMock()
    update_eq_chain.execute = update_execute
    update_eq_chain.eq = MagicMock(return_value=update_eq_chain)
    update_chain = MagicMock()
    update_chain.eq = update_eq_chain.eq

    table_mock = MagicMock()
    table_mock.select.return_value = select_chain
    table_mock.update.return_value = update_chain

    client.table.return_value = table_mock
    return client, select_chain


def _settings():
    s = MagicMock()
    s.vexa_gateway_url = "http://localhost:8056"
    s.vexa_api_key = "test-key"
    return s


def _meeting(**over):
    row = {
        "id": "m-1",
        "user_id": "u-1",
        "meet_url": "https://meet.google.com/abc-defg-hij",
        "native_meeting_id": None,
        "opted_in": True,
        "bot_status": "pending",
        "start_time": datetime.now(UTC).isoformat(),
    }
    row.update(over)
    return row


def _update_payloads(client):
    return [c.args[0] for c in client.table.return_value.update.call_args_list]


# --- get_due_meetings query -------------------------------------------------

async def test_get_due_meetings_builds_filtered_query():
    rows = [_meeting()]
    client, select_chain = _mock_client(rows)
    out = await ms.get_due_meetings(client)

    assert out == rows
    client.table.assert_called_with("meetings")
    # opted_in True + bot_status pending filters applied
    eq_calls = select_chain.eq.call_args_list
    assert any(c.args == ("opted_in", True) for c in eq_calls), eq_calls
    assert any(c.args == ("bot_status", "pending") for c in eq_calls), eq_calls
    # start_time window bounds applied via gte/lte
    select_chain.gte.assert_called_once()
    select_chain.lte.assert_called_once()
    assert select_chain.gte.call_args.args[0] == "start_time"
    assert select_chain.lte.call_args.args[0] == "start_time"


async def test_get_due_meetings_drops_rows_without_meet_url():
    rows = [_meeting(id="m-1"), _meeting(id="m-2", meet_url=None)]
    client, _ = _mock_client(rows)
    out = await ms.get_due_meetings(client)
    assert [r["id"] for r in out] == ["m-1"]


# --- dispatch_meeting -------------------------------------------------------

async def test_dispatch_success_marks_joining():
    client, _ = _mock_client()
    meeting = _meeting(id="m-1", user_id="u-42")

    with patch.object(
        ms, "spawn_bot",
        AsyncMock(return_value={"id": 130, "native_meeting_id": "abc"}),
    ) as spawn:
        await ms.dispatch_meeting(client, _settings(), meeting)

    # Gateway was called to spawn the bot.
    spawn.assert_awaited_once()
    # Row updated to bot_status='joining' (+ native_meeting_id from response).
    payloads = _update_payloads(client)
    assert any(
        p.get("bot_status") == "joining" and p.get("native_meeting_id") == "abc"
        for p in payloads
    ), payloads


async def test_dispatch_does_not_write_int_into_uuid_column():
    """The Vexa int id must NOT be written to the UUID vexa_meeting_id column."""
    client, _ = _mock_client()
    with patch.object(ms, "spawn_bot", AsyncMock(return_value={"id": 130})):
        await ms.dispatch_meeting(client, _settings(), _meeting())

    for p in _update_payloads(client):
        assert "vexa_meeting_id" not in p, p


async def test_dispatch_bot_failure_marks_failed():
    client, _ = _mock_client()
    with patch.object(
        ms, "spawn_bot", AsyncMock(side_effect=RuntimeError("gateway 500"))
    ):
        await ms.dispatch_meeting(client, _settings(), _meeting())

    payloads = _update_payloads(client)
    assert any(p.get("bot_status") == "failed" for p in payloads), payloads


# --- run_once dispatch-all (no slot limit) ----------------------------------

async def test_run_once_dispatches_a_bot_for_every_due_meeting():
    client, _ = _mock_client([_meeting(id="m-1"), _meeting(id="m-2"), _meeting(id="m-3")])

    with patch.object(ms, "dispatch_meeting", AsyncMock()) as dispatch:
        await ms.run_once(client, _settings())

    # Every due meeting is dispatched — concurrent meetings are fine now.
    assert dispatch.await_count == 3
    dispatched_ids = [c.args[2]["id"] for c in dispatch.await_args_list]
    assert dispatched_ids == ["m-1", "m-2", "m-3"]


async def test_run_once_noop_when_no_due_meetings():
    client, _ = _mock_client([])

    with patch.object(ms, "dispatch_meeting", AsyncMock()) as dispatch:
        await ms.run_once(client, _settings())

    dispatch.assert_not_called()


async def test_run_once_calls_gateway_for_each_meeting_end_to_end():
    """Without mocking dispatch_meeting, each due meeting hits the gateway once."""
    client, _ = _mock_client([_meeting(id="m-1"), _meeting(id="m-2")])

    with patch.object(
        ms, "spawn_bot", AsyncMock(return_value={"id": 1, "native_meeting_id": "n"})
    ) as spawn:
        await ms.run_once(client, _settings())

    assert spawn.await_count == 2
    payloads = _update_payloads(client)
    assert sum(1 for p in payloads if p.get("bot_status") == "joining") == 2
