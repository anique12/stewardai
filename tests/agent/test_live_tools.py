"""Tests for build_live_tool_functions risk gating."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

# Skip all tests if livekit not installed
livekit_agents = pytest.importorskip("livekit.agents")

from stewardai.agent.live_tools import build_live_tool_functions  # noqa: E402


def _make_service(slugs_risk=None):
    slugs_risk = slugs_risk or {"GMAIL_FETCH_EMAILS": "low", "GMAIL_SEND_EMAIL": "high"}
    svc = MagicMock()

    def _risk_of(slug):
        if slug not in slugs_risk:
            raise KeyError(slug)
        return slugs_risk[slug]

    svc.risk_of.side_effect = _risk_of
    svc.get_tools.return_value = [
        {
            "function": {
                "name": slug,
                "description": f"desc {slug}",
                "parameters": {"type": "object", "properties": {}},
            }
        }
        for slug in slugs_risk
    ]
    svc.execute.return_value = {"successful": True, "data": {}, "error": None}
    return svc


def _make_writer():
    writer = MagicMock()
    writer.insert = AsyncMock(return_value="row-1")
    # No prior actions by default → live dedup guard is a no-op.
    writer.existing_action_keys = AsyncMock(return_value=set())
    return writer


async def test_low_risk_tool_dedups_when_already_done():
    """The model re-calls a low-risk tool on each nudge; an identical
    (slug, args) action already recorded must NOT execute or insert again."""
    svc = _make_service({"GMAIL_FETCH_EMAILS": "low"})
    writer = _make_writer()
    # Called with no args → canonical args "{}".
    writer.existing_action_keys = AsyncMock(
        return_value={("GMAIL_FETCH_EMAILS", "{}")}
    )
    tools = build_live_tool_functions("u1", "m1", svc, writer)
    result = await tools[0]._func()
    assert "already" in result.lower()
    svc.execute.assert_not_called()
    writer.insert.assert_not_called()


async def test_low_risk_tool_executes_and_writes():
    svc = _make_service({"GMAIL_FETCH_EMAILS": "low"})
    writer = _make_writer()
    tools = build_live_tool_functions("u1", "m1", svc, writer)
    assert len(tools) == 1
    # Find the tool and call its underlying function
    tool = tools[0]
    # RawFunctionTool has a ._func attribute for the underlying callable
    result = await tool._func()
    assert "Done" in result or "completed" in result.lower() or "fetch" in result.lower()
    svc.execute.assert_called_once()
    writer.insert.assert_called_once()
    call_kwargs = writer.insert.call_args.kwargs
    assert call_kwargs["state"] == "done"


async def test_high_risk_tool_returns_confirm_string_no_execute():
    svc = _make_service({"GMAIL_SEND_EMAIL": "high"})
    writer = _make_writer()
    tools = build_live_tool_functions("u1", "m1", svc, writer)
    assert len(tools) == 1
    tool = tools[0]
    result = await tool._func()
    assert isinstance(result, str)
    assert len(result) > 0
    # Should NOT have executed
    svc.execute.assert_not_called()
    writer.insert.assert_not_called()


async def test_low_risk_tool_failure_writes_failed_row():
    """When a low-risk tool's execute raises, the function should return an
    apologetic string and log a failed row with the error message."""
    svc = _make_service({"GMAIL_FETCH_EMAILS": "low"})
    # Override the default return_value with a side_effect so execute raises
    svc.execute.side_effect = RuntimeError("boom")
    writer = _make_writer()
    tools = build_live_tool_functions("u1", "m1", svc, writer)
    assert len(tools) == 1
    tool = tools[0]
    result = await tool._func()

    # Result should be a non-empty apologetic string
    assert isinstance(result, str)
    assert len(result) > 0
    assert "Sorry" in result or "couldn't" in result or "fetch emails" in result.lower()

    # execute must have been attempted
    svc.execute.assert_called_once()

    # writer.insert must have been called with state="failed" and error containing "boom"
    writer.insert.assert_called_once()
    call_kwargs = writer.insert.call_args.kwargs
    assert call_kwargs["state"] == "failed"
    assert "boom" in call_kwargs["error"]


async def test_low_risk_tool_unsuccessful_writes_failed_row():
    """execute returns successful=False (no raise) -> row is failed and the
    spoken reply reports the error, not 'Done'."""
    svc = _make_service({"GMAIL_FETCH_EMAILS": "low"})
    svc.execute.return_value = {"successful": False, "error": "bad args", "data": {}}
    writer = _make_writer()
    tools = build_live_tool_functions("u1", "m1", svc, writer)
    result = await tools[0]._func()
    assert isinstance(result, str) and len(result) > 0
    svc.execute.assert_called_once()
    call_kwargs = writer.insert.call_args.kwargs
    assert call_kwargs["state"] == "failed"
    assert "bad args" in (call_kwargs.get("error") or "")
