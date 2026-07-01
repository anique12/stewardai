"""Tests for the meeting scheduler (bot + agent dispatch, single-slot lifecycle).

Everything external is mocked: the Supabase async client chain, the Vexa gateway
(via spawn_bot / httpx), and subprocess.Popen for the agent launch.
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

async def test_dispatch_success_marks_joining_and_spawns_agent():
    client, _ = _mock_client()
    meeting = _meeting(id="m-1", user_id="u-42")

    with (
        patch.object(
            ms, "spawn_bot",
            AsyncMock(return_value={"id": 130, "native_meeting_id": "abc"}),
        ),
        patch("subprocess.Popen") as popen,
    ):
        popen.return_value = MagicMock(name="proc")
        proc = await ms.dispatch_meeting(client, _settings(), meeting)

    assert proc is popen.return_value

    # Row updated to bot_status='joining' (+ native_meeting_id from response)
    payloads = _update_payloads(client)
    assert any(
        p.get("bot_status") == "joining" and p.get("native_meeting_id") == "abc"
        for p in payloads
    ), payloads

    # Agent spawned with the Vexa int id (as str) and the owner's user_id in env
    popen.assert_called_once()
    env = popen.call_args.kwargs["env"]
    assert env["VEXA_MEETING_ID"] == "130"
    assert env["VEXA_USER_ID"] == "u-42"


async def test_dispatch_does_not_write_int_into_uuid_column():
    """The Vexa int id must NOT be written to the UUID vexa_meeting_id column."""
    client, _ = _mock_client()
    with (
        patch.object(ms, "spawn_bot", AsyncMock(return_value={"id": 130})),
        patch("subprocess.Popen", return_value=MagicMock()),
    ):
        await ms.dispatch_meeting(client, _settings(), _meeting())

    for p in _update_payloads(client):
        assert "vexa_meeting_id" not in p, p


async def test_dispatch_bot_failure_marks_failed_and_returns_none():
    client, _ = _mock_client()
    with (
        patch.object(ms, "spawn_bot", AsyncMock(side_effect=RuntimeError("gateway 500"))),
        patch("subprocess.Popen") as popen,
    ):
        proc = await ms.dispatch_meeting(client, _settings(), _meeting())

    assert proc is None
    popen.assert_not_called()
    payloads = _update_payloads(client)
    assert any(p.get("bot_status") == "failed" for p in payloads), payloads


async def test_dispatch_agent_spawn_failure_marks_failed():
    client, _ = _mock_client()
    with (
        patch.object(ms, "spawn_bot", AsyncMock(return_value={"id": 130})),
        patch("subprocess.Popen", side_effect=OSError("bash not found")),
    ):
        proc = await ms.dispatch_meeting(client, _settings(), _meeting())

    assert proc is None
    assert any(p.get("bot_status") == "failed" for p in _update_payloads(client))


# --- run_once single-slot lifecycle -----------------------------------------

async def test_run_once_skips_dispatch_when_slot_busy():
    client, _ = _mock_client([_meeting()])
    live_proc = MagicMock()
    live_proc.poll.return_value = None  # still running
    state = ms.SchedulerState(meeting_id="m-active", proc=live_proc)

    with patch.object(ms, "dispatch_meeting", AsyncMock()) as dispatch:
        await ms.run_once(client, _settings(), state)

    dispatch.assert_not_called()
    # get_due_meetings should not even be queried when busy
    client.table.return_value.select.assert_not_called()
    assert state.meeting_id == "m-active"


async def test_run_once_reaps_finished_agent_and_marks_done():
    client, _ = _mock_client([])  # no due meetings after reaping
    dead_proc = MagicMock()
    dead_proc.poll.return_value = 0  # exited
    dead_proc.returncode = 0
    state = ms.SchedulerState(meeting_id="m-old", proc=dead_proc)

    await ms.run_once(client, _settings(), state)

    payloads = _update_payloads(client)
    assert any(p.get("bot_status") == "done" for p in payloads), payloads
    assert state.meeting_id is None
    assert state.proc is None


async def test_run_once_dispatches_first_due_meeting_when_free():
    client, _ = _mock_client([_meeting(id="m-1"), _meeting(id="m-2")])
    state = ms.SchedulerState()
    new_proc = MagicMock()

    with patch.object(ms, "dispatch_meeting", AsyncMock(return_value=new_proc)) as dispatch:
        await ms.run_once(client, _settings(), state)

    dispatch.assert_awaited_once()
    assert dispatch.await_args.args[2]["id"] == "m-1"  # first due meeting
    assert state.meeting_id == "m-1"
    assert state.proc is new_proc


async def test_run_once_leaves_slot_free_when_dispatch_returns_none():
    client, _ = _mock_client([_meeting(id="m-1")])
    state = ms.SchedulerState()

    with patch.object(ms, "dispatch_meeting", AsyncMock(return_value=None)):
        await ms.run_once(client, _settings(), state)

    assert state.meeting_id is None
    assert state.proc is None
