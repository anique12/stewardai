"""reconcile_stuck_meetings syncs our bot_status from Vexa's authoritative state.

A row stranded joining/in_meeting (agent restarted / connection dropped, so
teardown never wrote the final status) is closed only when Vexa no longer
reports an ACTIVE meeting for that native id — in_meeting -> done, joining ->
failed. A row Vexa still reports active (e.g. a meeting running past its
scheduled end) is left untouched.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from stewardai.scheduler import meeting_scheduler as ms


def _client(stale_rows):
    client = MagicMock()
    sel = MagicMock()
    sel.execute = AsyncMock(return_value=MagicMock(data=stale_rows))
    sel.in_.return_value = sel
    sel.lte.return_value = sel
    upd = MagicMock()
    upd.execute = AsyncMock(return_value=MagicMock(data=[{}]))
    upd.eq.return_value = upd
    table = MagicMock()
    table.select.return_value = sel
    table.update.return_value = upd
    client.table.return_value = table
    return client, table


def _settings():
    s = MagicMock()
    s.vexa_gateway_url = "http://gw"
    s.vexa_api_key = "k"
    return s


def _fake_vexa(bots):
    v = MagicMock()
    v.list_bots = AsyncMock(return_value=bots)
    return v


def _update_payloads(table):
    return [c.args[0] for c in table.update.call_args_list]


def _row(id, native, status):
    return {
        "id": id,
        "native_meeting_id": native,
        "bot_status": status,
        "updated_at": "2026-07-16T06:00:00+00:00",
    }


async def test_reconcile_closes_in_meeting_when_vexa_not_active():
    client, table = _client([_row("m-1", "abc", "in_meeting")])
    with patch(
        "stewardai.bridge.vexa_client.VexaClient",
        return_value=_fake_vexa([{"native_meeting_id": "abc", "status": "completed"}]),
    ):
        await ms.reconcile_stuck_meetings(client, _settings())
    payloads = _update_payloads(table)
    assert any(p.get("bot_status") == "done" for p in payloads), payloads


async def test_reconcile_leaves_row_when_vexa_still_active():
    client, table = _client([_row("m-1", "abc", "in_meeting")])
    with patch(
        "stewardai.bridge.vexa_client.VexaClient",
        return_value=_fake_vexa([{"native_meeting_id": "abc", "status": "active"}]),
    ):
        await ms.reconcile_stuck_meetings(client, _settings())
    assert table.update.call_count == 0


async def test_reconcile_joining_becomes_failed():
    client, table = _client([_row("m-2", "xyz", "joining")])
    with patch("stewardai.bridge.vexa_client.VexaClient", return_value=_fake_vexa([])):
        await ms.reconcile_stuck_meetings(client, _settings())
    payloads = _update_payloads(table)
    assert any(p.get("bot_status") == "failed" for p in payloads), payloads


async def test_reconcile_noop_when_no_stale_rows():
    client, table = _client([])
    with patch("stewardai.bridge.vexa_client.VexaClient", return_value=_fake_vexa([])) as V:
        await ms.reconcile_stuck_meetings(client, _settings())
    # No stale rows → we never even query Vexa.
    V.assert_not_called()
    assert table.update.call_count == 0
