"""Tests for Composio external-tool wrappers: graceful no-op with no service,
schema-driven tool construction + gate integration, and the connect-required
interrupt/retry flow on a "not connected" execute() signal. Fully offline --
no real Composio SDK or network calls."""
from __future__ import annotations

import stewardai.agent.chat.composio_tools as CT
from stewardai.agent.chat.composio_tools import build_composio_tools


def _schema(slug: str, description: str = "does a thing") -> dict:
    return {
        "type": "function",
        "function": {
            "name": slug,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": {"to": {"type": "string"}},
                "required": ["to"],
            },
        },
    }


class _FakeService:
    """Stand-in for ComposioService: get_tools() returns pinned schemas,
    execute() is scripted per-test."""

    def __init__(self, schemas, execute_fn=None):
        self._schemas = schemas
        self._execute_fn = execute_fn
        self.execute_calls: list[tuple] = []

    def get_tools(self, user_id):
        return self._schemas

    def execute(self, user_id, action_slug, arguments, **kwargs):
        self.execute_calls.append((user_id, action_slug, arguments))
        if self._execute_fn is not None:
            return self._execute_fn(len(self.execute_calls))
        return {"successful": True, "data": {"ok": True}}


class _NotConnectedError(Exception):
    """Stands in for composio.exceptions.ConnectedAccountError by name."""


# Rename so `_is_not_connected`'s class-name heuristic ("ConnectedAccount" in
# type(exc).__name__) matches, exactly like the real SDK's
# ConnectedAccountNotFoundError would.
_NotConnectedError.__name__ = "ConnectedAccountNotFoundError"


# --- (1) composio_service=None -------------------------------------------


async def test_build_composio_tools_returns_empty_when_service_none():
    tools = build_composio_tools(user_id="u1", composio_service=None)
    assert tools == []


async def test_build_composio_tools_returns_empty_when_listing_fails():
    class _BrokenService:
        def get_tools(self, user_id):
            raise RuntimeError("composio API down")

    tools = build_composio_tools(user_id="u1", composio_service=_BrokenService())
    assert tools == []


# --- (2) one tool, gate -> auto, execute succeeds -------------------------


async def test_build_composio_tools_returns_one_tool_with_right_name(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    service = _FakeService([_schema("GMAIL_SEND_EMAIL")])

    tools = build_composio_tools(user_id="u1", composio_service=service)

    assert len(tools) == 1
    assert tools[0].name == "GMAIL_SEND_EMAIL"


async def _auto(*_a, **_k):
    return "auto", None


async def test_tool_invocation_executes_via_service_and_returns_result(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    service = _FakeService([_schema("GMAIL_SEND_EMAIL")])

    tools = build_composio_tools(user_id="u1", composio_service=service, client="the-client")
    result = await tools[0].ainvoke({"to": "bob@example.com"})

    assert result == {"successful": True, "data": {"ok": True}}
    assert service.execute_calls == [("u1", "GMAIL_SEND_EMAIL", {"to": "bob@example.com"})]


async def test_tool_invocation_passes_client_through_to_gate(monkeypatch):
    seen = {}

    async def _capturing_gate(client, *, user_id, tool_name, payload):
        seen["client"] = client
        seen["user_id"] = user_id
        seen["tool_name"] = tool_name
        seen["payload"] = payload
        return "auto", None

    monkeypatch.setattr(CT, "gate", _capturing_gate)
    service = _FakeService([_schema("GMAIL_SEND_EMAIL")])
    tools = build_composio_tools(user_id="u1", composio_service=service, client="the-client")

    await tools[0].ainvoke({"to": "bob@example.com"})

    assert seen["client"] == "the-client"
    assert seen["user_id"] == "u1"
    assert seen["tool_name"] == "GMAIL_SEND_EMAIL"
    assert seen["payload"]["app"] == "gmail"
    assert seen["payload"]["args"] == {"to": "bob@example.com"}


async def test_tool_invocation_skips_mutation_on_reject(monkeypatch):
    async def _reject(*_a, **_k):
        return "reject", None

    monkeypatch.setattr(CT, "gate", _reject)
    service = _FakeService([_schema("GMAIL_SEND_EMAIL")])
    tools = build_composio_tools(user_id="u1", composio_service=service)

    result = await tools[0].ainvoke({"to": "bob@example.com"})

    assert result == {"skipped": True}
    assert service.execute_calls == []


# --- (3) not-connected -> connect_required interrupt + retry --------------


async def test_not_connected_interrupts_then_retries_on_resume(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())

    captured_payloads = []

    def _fake_interrupt(payload):
        captured_payloads.append(payload)
        return "retry"

    monkeypatch.setattr(CT, "interrupt", _fake_interrupt)

    def _execute_fn(call_count):
        if call_count == 1:
            raise _NotConnectedError("no active connected account for gmail")
        return {"successful": True, "data": {"sent": True}}

    service = _FakeService([_schema("GMAIL_SEND_EMAIL")], execute_fn=_execute_fn)
    tools = build_composio_tools(user_id="u1", composio_service=service)

    result = await tools[0].ainvoke({"to": "bob@example.com"})

    # First execute() failed as "not connected" -> one connect interrupt was
    # raised for the right app/tool, resumed with "retry" -> executed again
    # and this time succeeded.
    assert captured_payloads == [
        {"kind": "connect", "app": "gmail", "tool": "GMAIL_SEND_EMAIL"}
    ]
    assert len(service.execute_calls) == 2
    assert result == {"successful": True, "data": {"sent": True}}


async def test_real_composio_connected_account_error_is_detected(monkeypatch):
    """Primary detection path: the actual SDK exception type (not just the
    class-name fallback used by the other tests' stand-in)."""
    from composio.exceptions import ConnectedAccountNotFoundError

    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    monkeypatch.setattr(CT, "interrupt", lambda payload: "cancel")

    def _execute_fn(_call_count):
        raise ConnectedAccountNotFoundError("no connected account")

    service = _FakeService(
        [_schema("SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL")], execute_fn=_execute_fn
    )
    tools = build_composio_tools(user_id="u1", composio_service=service)

    result = await tools[0].ainvoke({"to": "general"})

    assert result == {
        "connect_required": True,
        "app": "slack",
        "tool": "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
    }


async def test_not_connected_gives_up_after_one_retry_still_failing(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    monkeypatch.setattr(CT, "interrupt", lambda payload: "retry")

    def _execute_fn(_call_count):
        raise _NotConnectedError("no active connected account for gmail")

    service = _FakeService([_schema("GMAIL_SEND_EMAIL")], execute_fn=_execute_fn)
    tools = build_composio_tools(user_id="u1", composio_service=service)

    result = await tools[0].ainvoke({"to": "bob@example.com"})

    # Exactly one retry attempted (2 execute() calls total), then gives up.
    assert len(service.execute_calls) == 2
    assert result == {"connect_required": True, "app": "gmail", "tool": "GMAIL_SEND_EMAIL"}


async def test_not_connected_via_unsuccessful_result_flag(monkeypatch):
    """Some SDK paths report failure via a result dict instead of raising."""
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    monkeypatch.setattr(CT, "interrupt", lambda payload: "cancel")

    service = _FakeService(
        [_schema("GMAIL_SEND_EMAIL")],
        execute_fn=lambda _n: {
            "successful": False,
            "error": "No connected account found for this user",
        },
    )
    tools = build_composio_tools(user_id="u1", composio_service=service)

    result = await tools[0].ainvoke({"to": "bob@example.com"})

    assert result == {"connect_required": True, "app": "gmail", "tool": "GMAIL_SEND_EMAIL"}
    # "cancel" is not "retry", so no second execute() attempt is made.
    assert len(service.execute_calls) == 1


async def test_unrelated_execute_error_is_not_treated_as_connect_required(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())

    def _no_interrupt(_payload):
        raise AssertionError("interrupt should not fire for an unrelated error")

    monkeypatch.setattr(CT, "interrupt", _no_interrupt)

    def _execute_fn(_n):
        raise ValueError("bad argument: recipient missing")

    service = _FakeService([_schema("GMAIL_SEND_EMAIL")], execute_fn=_execute_fn)
    tools = build_composio_tools(user_id="u1", composio_service=service)

    result = await tools[0].ainvoke({"to": "bob@example.com"})

    assert result == {"ok": False, "error": "bad argument: recipient missing"}
    assert len(service.execute_calls) == 1
