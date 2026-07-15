"""Tests for run_pending_actions_once."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from stewardai.scheduler.action_worker import run_forever, run_pending_actions_once


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
    # A single shared eq MagicMock is used so all .eq() calls land in one call_args_list.
    update_execute = AsyncMock(return_value=MagicMock(data=[{}]))
    update_eq_chain = MagicMock()
    update_eq_chain.execute = update_execute
    # Both the first and subsequent .eq() calls return the same chain object.
    # Using the same MagicMock for .eq lets us capture every .eq(key, value) call.
    update_eq_chain.eq = MagicMock(return_value=update_eq_chain)
    update_chain = MagicMock()
    # .update(...).eq(...) returns update_eq_chain; further .eq() also uses the same mock.
    update_chain.eq = update_eq_chain.eq

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

    # Verify the update payloads: first "running" then "failed" with error message
    update_payloads = [c.args[0] for c in client.table.return_value.update.call_args_list]
    assert {"state": "running"} in update_payloads, (
        f"Expected a running-transition payload in {update_payloads}"
    )
    assert any(
        p.get("state") == "failed" and p.get("error") == "composio down"
        for p in update_payloads
    ), f"Expected a failed payload with error='composio down' in {update_payloads}"


async def test_non_approved_row_not_in_results():
    # The query filters by state='approved' so this row wouldn't appear
    # Verify empty rows = 0 processed
    client, _ = _mock_client([])
    svc = _make_service()
    count = await run_pending_actions_once(client, svc)
    assert count == 0
    svc.execute.assert_not_called()


async def test_running_transition_is_race_guarded():
    """The running-transition update must apply BOTH eq("id", row_id) AND
    eq("state", "approved") to guard against concurrent workers stealing the row."""
    row = {
        "id": "r1",
        "user_id": "u1",
        "action_slug": "GMAIL_FETCH_EMAILS",
        "args": {},
        "state": "approved",
    }
    client, _ = _mock_client([row])
    svc = _make_service()
    await run_pending_actions_once(client, svc)

    # Collect all .eq() calls across the entire update chain.
    # _mock_client sets update_chain.eq == update_eq_chain.eq so every
    # .eq(key, value) call on either link ends up in the same call_args_list.
    eq_mock = client.table.return_value.update.return_value.eq
    eq_calls = eq_mock.call_args_list

    assert call("id", "r1") in eq_calls, (
        f"Expected eq('id', 'r1') in update chain eq calls: {eq_calls}"
    )
    assert call("state", "approved") in eq_calls, (
        f"Expected eq('state', 'approved') race-guard in update chain eq calls: {eq_calls}"
    )


async def test_approved_row_becomes_failed_on_unsuccessful_result():
    """Composio reports bad-args / API rejections via successful=False WITHOUT
    raising; the worker must mark such rows failed, not done."""
    row = {
        "id": "r1",
        "user_id": "u1",
        "action_slug": "GMAIL_FETCH_EMAILS",
        "args": {},
        "state": "approved",
    }
    client, _ = _mock_client([row])
    svc = _make_service(execute_result={"successful": False, "error": "bad args", "data": {}})
    count = await run_pending_actions_once(client, svc)
    assert count == 0  # not counted as done
    update_payloads = [c.args[0] for c in client.table.return_value.update.call_args_list]
    assert any(
        p.get("state") == "failed" and p.get("error") == "bad args"
        for p in update_payloads
    ), f"Expected a failed payload with error='bad args' in {update_payloads}"


class _StopLoop(Exception):
    """Raised from the patched asyncio.sleep to break run_forever after one cycle."""


async def _run_forever_one_cycle(settings):
    """Run run_forever for exactly one cycle, patching out all its dependencies."""
    with (
        patch("stewardai.config.get_settings", return_value=settings),
        patch(
            "stewardai.integrations.supabase_client.create_service_client",
            new=AsyncMock(return_value=MagicMock()),
        ),
        patch("stewardai.integrations.composio_service.ComposioService"),
        patch("stewardai.email.resend_client.ResendClient") as resend_cls,
        patch(
            "stewardai.email.sender.run_pending_emails_once", new=AsyncMock(return_value=0)
        ) as emails_once,
        patch(
            "stewardai.scheduler.action_worker.run_pending_actions_once",
            new=AsyncMock(return_value=0),
        ),
        patch("asyncio.sleep", new=AsyncMock(side_effect=_StopLoop)),
    ):
        with pytest.raises(_StopLoop):
            await run_forever(interval_s=1)
        return resend_cls, emails_once


async def test_run_forever_builds_resend_when_email_enabled():
    settings = MagicMock(email_enabled=True, resend_api_key="key123")
    resend_cls, emails_once = await _run_forever_one_cycle(settings)
    resend_cls.assert_called_once_with("key123")
    emails_once.assert_awaited_once()


async def test_run_forever_skips_resend_when_email_disabled():
    settings = MagicMock(email_enabled=False, resend_api_key=None)
    resend_cls, emails_once = await _run_forever_one_cycle(settings)
    resend_cls.assert_not_called()
    emails_once.assert_not_awaited()
