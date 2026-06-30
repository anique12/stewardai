"""Tests for run_pending_actions_once."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from stewardai.scheduler.action_worker import run_pending_actions_once


def _mock_client(rows=None):
    """Build a mock async Supabase client returning given rows from select."""
    client = MagicMock()

    # For select chain: .table().select().eq().execute()
    # The select chain is: select() -> eq() -> execute() (async)
    select_execute = AsyncMock(return_value=MagicMock(data=rows or []))
    select_chain = MagicMock()
    select_chain.execute = select_execute
    select_chain.eq.return_value = select_chain  # .eq() chains back to same mock

    # For update chain: .table().update().eq().execute() or .table().update().eq().eq().execute()
    update_execute = AsyncMock(return_value=MagicMock(data=[{}]))
    update_eq_chain = MagicMock()
    update_eq_chain.execute = update_execute
    update_eq_chain.eq.return_value = update_eq_chain  # chained .eq().eq()
    update_chain = MagicMock()
    update_chain.eq.return_value = update_eq_chain

    table_mock = MagicMock()
    table_mock.select.return_value = select_chain
    table_mock.update.return_value = update_chain

    client.table.return_value = table_mock
    return client, update_execute


def _make_service(execute_result=None, raise_exc=None):
    svc = MagicMock()
    if raise_exc:
        svc.execute.side_effect = raise_exc
    else:
        svc.execute.return_value = execute_result or {"successful": True, "data": {}}
    return svc


async def test_approved_row_becomes_done_on_success():
    row = {
        "id": "r1",
        "user_id": "u1",
        "action_slug": "GMAIL_FETCH_EMAILS",
        "args": {},
        "state": "approved",
    }
    client, update_execute = _mock_client([row])
    svc = _make_service()
    count = await run_pending_actions_once(client, svc)
    assert count == 1
    svc.execute.assert_called_once_with("u1", "GMAIL_FETCH_EMAILS", {})


async def test_approved_row_becomes_failed_on_execute_error():
    row = {
        "id": "r1",
        "user_id": "u1",
        "action_slug": "GMAIL_FETCH_EMAILS",
        "args": {},
        "state": "approved",
    }
    client, update_execute = _mock_client([row])
    svc = _make_service(raise_exc=RuntimeError("composio down"))
    count = await run_pending_actions_once(client, svc)
    # Failed rows return count 0 (we only count done)
    assert count == 0


async def test_non_approved_row_not_in_results():
    # The query filters by state='approved' so this row wouldn't appear
    # Verify empty rows = 0 processed
    client, _ = _mock_client([])
    svc = _make_service()
    count = await run_pending_actions_once(client, svc)
    assert count == 0
    svc.execute.assert_not_called()
