"""Tests for the Composio generic-executor tools (progressive tool disclosure):
build returns describe_action + run_integration_action; run_integration_action
goes through the permission gate + connect-required interrupt/retry keyed on the
real action slug. Fully offline -- no real Composio SDK or network calls."""
from __future__ import annotations

import json

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
        self.get_tools_calls: list[dict] = []

    def get_tools(self, user_id, toolkits=None, *, only_connected=True):
        self.get_tools_calls.append({"toolkits": toolkits, "only_connected": only_connected})
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


async def _auto(*_a, **_k):
    return "auto", None


def _describe_tool(service, client=None):
    return build_composio_tools(user_id="u1", composio_service=service, client=client)[0]


def _run_tool(service, client=None):
    return build_composio_tools(user_id="u1", composio_service=service, client=client)[1]


def _run_input(action, args, app="gmail"):
    return {"app": app, "action": action, "args_json": json.dumps(args)}


# --- build shape ----------------------------------------------------------


async def test_build_returns_empty_when_service_none():
    assert build_composio_tools(user_id="u1", composio_service=None) == []


async def test_build_returns_two_generic_tools():
    tools = build_composio_tools(user_id="u1", composio_service=_FakeService([]))
    assert [t.name for t in tools] == ["describe_action", "run_integration_action"]


# --- describe_action (on-demand schemas) ----------------------------------


async def test_describe_action_returns_schemas_unconnected():
    service = _FakeService([_schema("GMAIL_SEND_EMAIL"), _schema("GMAIL_FETCH_EMAILS")])
    describe = _describe_tool(service)

    out = await describe.ainvoke({"app": "gmail"})

    assert out["app"] == "gmail"
    assert [a["action"] for a in out["actions"]] == ["GMAIL_SEND_EMAIL", "GMAIL_FETCH_EMAILS"]
    assert out["actions"][0]["parameters"]["properties"] == {"to": {"type": "string"}}
    # Schemas are fetched for ALL toolkits (unconnected too) so connect-flow works.
    assert service.get_tools_calls == [{"toolkits": ["gmail"], "only_connected": False}]


async def test_describe_action_rejects_unknown_app():
    out = await _describe_tool(_FakeService([])).ainvoke({"app": "dropbox"})
    assert "error" in out


# --- run_integration_action: gate -> auto -> execute ----------------------


async def test_run_executes_via_service_and_returns_result(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    service = _FakeService([])

    result = await _run_tool(service, client="the-client").ainvoke(
        _run_input("GMAIL_SEND_EMAIL", {"to": "bob@example.com"})
    )

    assert result == {"successful": True, "data": {"ok": True}}
    assert service.execute_calls == [("u1", "GMAIL_SEND_EMAIL", {"to": "bob@example.com"})]


async def test_run_passes_slug_and_args_to_gate(monkeypatch):
    seen = {}

    async def _capturing_gate(client, *, user_id, tool_name, payload):
        seen.update(client=client, user_id=user_id, tool_name=tool_name, payload=payload)
        return "auto", None

    monkeypatch.setattr(CT, "gate", _capturing_gate)

    await _run_tool(_FakeService([]), client="the-client").ainvoke(
        _run_input("GMAIL_SEND_EMAIL", {"to": "bob@example.com"})
    )

    assert seen["client"] == "the-client"
    assert seen["tool_name"] == "GMAIL_SEND_EMAIL"  # real slug → correct tier + card
    assert seen["payload"]["app"] == "gmail"
    assert seen["payload"]["action"] == "GMAIL_SEND_EMAIL"
    assert seen["payload"]["args"] == {"to": "bob@example.com"}


async def test_run_honors_edited_args_from_approval_card(monkeypatch):
    async def _approve_with_edit(*_a, **_k):
        return "approve", {"to": "edited@example.com", "subject": "Hi"}

    monkeypatch.setattr(CT, "gate", _approve_with_edit)
    service = _FakeService([])

    await _run_tool(service).ainvoke(_run_input("GMAIL_SEND_EMAIL", {"to": "orig@example.com"}))

    # Edited args (from the card) override the model's draft.
    assert service.execute_calls == [
        ("u1", "GMAIL_SEND_EMAIL", {"to": "edited@example.com", "subject": "Hi"})
    ]


async def test_run_skips_on_reject(monkeypatch):
    async def _reject(*_a, **_k):
        return "reject", None

    monkeypatch.setattr(CT, "gate", _reject)
    service = _FakeService([])

    result = await _run_tool(service).ainvoke(_run_input("GMAIL_SEND_EMAIL", {"to": "b@x.com"}))

    assert result == {"skipped": True}
    assert service.execute_calls == []


async def test_run_rejects_malformed_args_json(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    service = _FakeService([])

    result = await _run_tool(service).ainvoke(
        {"app": "gmail", "action": "GMAIL_SEND_EMAIL", "args_json": "not json"}
    )

    assert result["ok"] is False and "JSON" in result["error"]
    assert service.execute_calls == []


# --- connect-required interrupt + retry (via run_integration_action) -------


async def test_not_connected_interrupts_then_retries_on_resume(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    captured = []

    def _fake_interrupt(payload):
        captured.append(payload)
        return "retry"

    monkeypatch.setattr(CT, "interrupt", _fake_interrupt)

    def _execute_fn(call_count):
        if call_count == 1:
            raise _NotConnectedError("no active connected account for gmail")
        return {"successful": True, "data": {"sent": True}}

    service = _FakeService([], execute_fn=_execute_fn)
    result = await _run_tool(service).ainvoke(_run_input("GMAIL_SEND_EMAIL", {"to": "b@x.com"}))

    assert captured == [{"kind": "connect", "app": "gmail", "tool": "GMAIL_SEND_EMAIL"}]
    assert len(service.execute_calls) == 2
    assert result == {"successful": True, "data": {"sent": True}}


async def test_real_composio_connected_account_error_is_detected(monkeypatch):
    from composio.exceptions import ConnectedAccountNotFoundError

    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    monkeypatch.setattr(CT, "interrupt", lambda payload: "cancel")

    def _execute_fn(_n):
        raise ConnectedAccountNotFoundError("no connected account")

    service = _FakeService([], execute_fn=_execute_fn)
    result = await _run_tool(service).ainvoke(
        _run_input("SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL", {"text": "hi"}, app="slack")
    )

    assert result == {
        "connect_required": True,
        "app": "slack",
        "tool": "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
    }


async def test_not_connected_gives_up_after_one_retry(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    monkeypatch.setattr(CT, "interrupt", lambda payload: "retry")

    def _execute_fn(_n):
        raise _NotConnectedError("no active connected account for gmail")

    service = _FakeService([], execute_fn=_execute_fn)
    result = await _run_tool(service).ainvoke(_run_input("GMAIL_SEND_EMAIL", {"to": "b@x.com"}))

    assert len(service.execute_calls) == 2
    assert result == {"connect_required": True, "app": "gmail", "tool": "GMAIL_SEND_EMAIL"}


async def test_not_connected_via_unsuccessful_result_flag(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())
    monkeypatch.setattr(CT, "interrupt", lambda payload: "cancel")

    service = _FakeService(
        [],
        execute_fn=lambda _n: {
            "successful": False,
            "error": "No connected account found for this user",
        },
    )
    result = await _run_tool(service).ainvoke(_run_input("GMAIL_SEND_EMAIL", {"to": "b@x.com"}))

    assert result == {"connect_required": True, "app": "gmail", "tool": "GMAIL_SEND_EMAIL"}
    assert len(service.execute_calls) == 1


async def test_unrelated_execute_error_is_not_connect_required(monkeypatch):
    monkeypatch.setattr(CT, "gate", lambda *a, **k: _auto())

    def _no_interrupt(_payload):
        raise AssertionError("interrupt should not fire for an unrelated error")

    monkeypatch.setattr(CT, "interrupt", _no_interrupt)

    def _execute_fn(_n):
        raise ValueError("bad argument: recipient missing")

    service = _FakeService([], execute_fn=_execute_fn)
    result = await _run_tool(service).ainvoke(_run_input("GMAIL_SEND_EMAIL", {"to": "b@x.com"}))

    assert result == {"ok": False, "error": "bad argument: recipient missing"}
    assert len(service.execute_calls) == 1


# --- result formatters (unchanged) ----------------------------------------


def test_format_calendar_events_extracts_readable_times():
    from stewardai.agent.chat.composio_tools import _format_calendar_events

    result = {
        "data": {
            "items": [
                {
                    "summary": "Stand Up",
                    "start": {"dateTime": "2026-07-04T11:15:00+05:00", "timeZone": "Asia/Karachi"},
                    "end": {"dateTime": "2026-07-04T11:35:00+05:00", "timeZone": "Asia/Karachi"},
                }
            ]
        }
    }
    out = _format_calendar_events("GOOGLECALENDAR_EVENTS_LIST", result)
    assert out is not None
    ev = out["events"][0]
    assert ev["summary"] == "Stand Up"
    assert "11:15 AM" in ev["start"]
    assert "11:35 AM" in ev["end"]


def test_format_calendar_events_returns_none_for_other_actions():
    from stewardai.agent.chat.composio_tools import _format_calendar_events

    assert _format_calendar_events("GMAIL_SEND_EMAIL", {"data": {}}) is None
