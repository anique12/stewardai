"""Tests for extract_post_meeting_actions."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

from stewardai.agent.actions import extract_post_meeting_actions


def _make_service(connected=None, risk_map=None):
    svc = MagicMock()
    svc.list_connected.return_value = connected or ["gmail"]
    rm = risk_map or {
        "GMAIL_SEND_EMAIL": "high",
        "GMAIL_FETCH_EMAILS": "low",
        "GMAIL_CREATE_EMAIL_DRAFT": "low",
    }

    def _risk_of(slug):
        if slug not in rm:
            raise KeyError(slug)
        return rm[slug]

    svc.risk_of.side_effect = _risk_of
    # Extraction is now schema-driven: it reads tool schemas from get_tools and
    # derives the allow-list from their names. Expose one schema per allowed slug.
    svc.get_tools.return_value = [
        {
            "type": "function",
            "function": {
                "name": s,
                "description": s,
                "parameters": {"type": "object", "properties": {}},
            },
        }
        for s in rm
    ]
    return svc


def _make_writer():
    writer = MagicMock()
    writer.insert = AsyncMock(return_value="row-1")
    writer.update_state = AsyncMock()
    return writer


def _make_llm(json_items):
    """Mock LLM that yields the JSON array as a single chunk."""
    llm = MagicMock()

    def _complete(*args, **kwargs):
        async def _inner():
            yield json.dumps(json_items)

        return _inner()

    llm.complete.side_effect = _complete
    return llm


async def test_directed_low_risk_becomes_approved():
    items = [
        {
            "source": "directed",
            "title": "Fetch emails",
            "action_slug": "GMAIL_FETCH_EMAILS",
            "toolkit": "gmail",
            "args": {},
        }
    ]
    llm = _make_llm(items)
    service = _make_service()
    writer = _make_writer()
    count = await extract_post_meeting_actions(
        llm,
        ["[Alice]: Steward, fetch my emails"],
        user_id="u1",
        meeting_id="m1",
        composio_service=service,
        writer=writer,
    )
    assert count == 1
    call_kwargs = writer.insert.call_args.kwargs
    assert call_kwargs["state"] == "approved"
    assert call_kwargs["source"] == "directed"


async def test_directed_high_risk_becomes_proposed():
    items = [
        {
            "source": "directed",
            "title": "Send email",
            "action_slug": "GMAIL_SEND_EMAIL",
            "toolkit": "gmail",
            "args": {},
        }
    ]
    llm = _make_llm(items)
    service = _make_service()
    writer = _make_writer()
    count = await extract_post_meeting_actions(
        llm,
        ["[Alice]: Steward, send email"],
        user_id="u1",
        meeting_id="m1",
        composio_service=service,
        writer=writer,
    )
    assert count == 1
    call_kwargs = writer.insert.call_args.kwargs
    assert call_kwargs["state"] == "proposed"


async def test_inferred_becomes_proposed():
    items = [
        {
            "source": "inferred",
            "title": "Create draft",
            "action_slug": "GMAIL_CREATE_EMAIL_DRAFT",
            "toolkit": "gmail",
            "args": {},
        }
    ]
    llm = _make_llm(items)
    service = _make_service()
    writer = _make_writer()
    count = await extract_post_meeting_actions(
        llm,
        ["[Bob]: Let's send a recap"],
        user_id="u1",
        meeting_id="m1",
        composio_service=service,
        writer=writer,
    )
    assert count == 1
    call_kwargs = writer.insert.call_args.kwargs
    assert call_kwargs["state"] == "proposed"


async def test_slug_not_on_allow_list_is_skipped():
    items = [
        {
            "source": "directed",
            "title": "Unknown",
            "action_slug": "UNKNOWN_ACTION",
            "toolkit": "gmail",
            "args": {},
        }
    ]
    llm = _make_llm(items)
    service = _make_service()
    writer = _make_writer()
    count = await extract_post_meeting_actions(
        llm,
        ["[Alice]: do something"],
        user_id="u1",
        meeting_id="m1",
        composio_service=service,
        writer=writer,
    )
    assert count == 0
    writer.insert.assert_not_called()


async def test_no_connected_toolkits_returns_zero():
    llm = _make_llm([])
    service = _make_service(connected=[])
    writer = _make_writer()
    count = await extract_post_meeting_actions(
        llm,
        ["[Alice]: something"],
        user_id="u1",
        meeting_id="m1",
        composio_service=service,
        writer=writer,
    )
    assert count == 0
    writer.insert.assert_not_called()


def test_extraction_prompt_numbers_transcript_lines():
    from stewardai.agent.actions import _build_extraction_prompt
    prompt = _build_extraction_prompt(
        tools=[{"function": {"name": "GMAIL_SEND_EMAIL", "description": "d", "parameters": {}}}],
        transcript=["[Anique]: do X", "[Sam]: ok"],
        now_iso="2026-07-02T10:00:00",
        timezone="UTC",
    )
    assert "0: [Anique]: do X" in prompt
    assert "1: [Sam]: ok" in prompt


def test_coerce_source_line():
    from stewardai.agent.actions import _coerce_source_line
    assert _coerce_source_line(3) == 3
    assert _coerce_source_line("2") == 2
    assert _coerce_source_line("nope") is None
    assert _coerce_source_line(None) is None
