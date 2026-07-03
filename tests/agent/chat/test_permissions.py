"""Tests for permission tiers + gating: tier_of classification and gate()'s
auto/interrupt/allowlist behavior.
"""
from __future__ import annotations

import pytest

from stewardai.agent.chat import permissions
from stewardai.agent.chat.permissions import gate, tier_of


def _no_interrupt(_payload):
    raise AssertionError("interrupt should not be called for this tier/path")


class _FakeClient:
    """Placeholder client; gate() only threads it through to store fns, which
    are monkeypatched in these tests."""


# --- tier_of -----------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    ["kb_search", "list_spaces", "list_meetings", "lookup_entity", "list_calendar_events"],
)
def test_tier_of_read_tools(name):
    assert tier_of(name) == "read"


@pytest.mark.parametrize(
    "name",
    [
        "create_space",
        "rename_space",
        "file_meeting",
        "add_tag",
        "remove_tag",
        "complete_action_item",
        "reopen_action_item",
    ],
)
def test_tier_of_reversible_tools(name):
    assert tier_of(name) == "reversible"


@pytest.mark.parametrize(
    "name",
    [
        "archive_space",
        "send_email",
        "create_calendar_event",
        "create_notion_page",
        "post_slack_message",
    ],
)
def test_tier_of_outward_tools(name):
    assert tier_of(name) == "outward"


def test_tier_of_unknown_tool_defaults_to_outward():
    """Unknown tools must gate rather than run automatically."""
    assert tier_of("some_never_seen_tool") == "outward"


# --- gate: read / reversible --------------------------------------------


async def test_gate_read_tool_returns_auto_without_interrupt(monkeypatch):
    monkeypatch.setattr(permissions, "interrupt", _no_interrupt)

    async def _false_is_allowed(*_a, **_k):
        return False

    monkeypatch.setattr(permissions, "is_allowed", _false_is_allowed)

    result = await gate(
        _FakeClient(), user_id="u1", tool_name="kb_search", payload={"query": "x"}
    )
    assert result == "auto"


async def test_gate_reversible_tool_returns_auto_without_interrupt(monkeypatch):
    monkeypatch.setattr(permissions, "interrupt", _no_interrupt)

    async def _false_is_allowed(*_a, **_k):
        return False

    monkeypatch.setattr(permissions, "is_allowed", _false_is_allowed)

    result = await gate(
        _FakeClient(), user_id="u1", tool_name="add_tag", payload={"tag": "x"}
    )
    assert result == "auto"


# --- gate: outward -------------------------------------------------------


async def test_gate_outward_not_allowlisted_interrupts_and_returns_decision(monkeypatch):
    async def _false_is_allowed(*_a, **_k):
        return False

    def _interrupt(payload):
        assert payload == {"kind": "permission", "tool": "send_email", "to": "a@b.com"}
        return "approve"

    monkeypatch.setattr(permissions, "is_allowed", _false_is_allowed)
    monkeypatch.setattr(permissions, "interrupt", _interrupt)

    result = await gate(
        _FakeClient(),
        user_id="u1",
        tool_name="send_email",
        payload={"to": "a@b.com"},
    )
    assert result == "approve"


async def test_gate_outward_allowlisted_returns_auto_without_interrupt(monkeypatch):
    async def _true_is_allowed(*_a, **_k):
        return True

    monkeypatch.setattr(permissions, "is_allowed", _true_is_allowed)
    monkeypatch.setattr(permissions, "interrupt", _no_interrupt)

    result = await gate(
        _FakeClient(),
        user_id="u1",
        tool_name="send_email",
        payload={"to": "a@b.com"},
    )
    assert result == "auto"


async def test_gate_outward_always_decision_sets_allowlist_and_returns_approve(monkeypatch):
    async def _false_is_allowed(*_a, **_k):
        return False

    calls = []

    async def _set_allowed(_client, *, user_id, tool_name):
        calls.append((user_id, tool_name))

    monkeypatch.setattr(permissions, "is_allowed", _false_is_allowed)
    monkeypatch.setattr(permissions, "set_allowed", _set_allowed)
    monkeypatch.setattr(permissions, "interrupt", lambda _payload: "always")

    result = await gate(
        _FakeClient(),
        user_id="u1",
        tool_name="post_slack_message",
        payload={"text": "hi"},
    )
    assert result == "approve"
    assert calls == [("u1", "post_slack_message")]


async def test_gate_outward_reject_decision_returns_reject(monkeypatch):
    async def _false_is_allowed(*_a, **_k):
        return False

    monkeypatch.setattr(permissions, "is_allowed", _false_is_allowed)
    monkeypatch.setattr(permissions, "interrupt", lambda _payload: "reject")

    result = await gate(
        _FakeClient(),
        user_id="u1",
        tool_name="create_notion_page",
        payload={"title": "x"},
    )
    assert result == "reject"
