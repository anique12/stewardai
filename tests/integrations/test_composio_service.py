"""Unit tests for ComposioService.

All tests mock the Composio client — no network calls are made.  The optional
live smoke test is skipped unless COMPOSIO_API_KEY is set in the environment.
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from stewardai.integrations.composio_service import (
    _ALLOW_LIST,
    _ALLOWED_SLUGS,
    _RISK_MAP,
    TOOLKITS,
    ComposioService,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_account(toolkit_slug: str, status: str = "ACTIVE") -> SimpleNamespace:
    """Build a fake connected-account object resembling what the SDK returns."""
    return SimpleNamespace(
        toolkit=SimpleNamespace(slug=toolkit_slug),
        status=status,
    )


def _make_client(connected_slugs: list[str] | None = None) -> MagicMock:
    """Return a mock Composio client pre-configured with connected accounts."""
    connected_slugs = connected_slugs or []
    items = [_make_account(s) for s in connected_slugs]

    client = MagicMock()
    client.connected_accounts.list.return_value = SimpleNamespace(items=items)
    # tools.get returns a list of OpenAI-format dicts by default
    client.tools.get.return_value = [
        {"type": "function", "function": {"name": slug, "description": "test", "parameters": {}}}
        for slug in (
            slug
            for tk in connected_slugs
            for slug, _ in _ALLOW_LIST.get(tk, [])
        )
    ]
    client.tools.execute.return_value = {
        "data": {"result": "ok"},
        "error": None,
        "successful": True,
    }
    return client


def _service_with_mock(
    connected_slugs: list[str] | None = None,
) -> tuple[ComposioService, MagicMock]:
    """Return a ComposioService whose _composio property is replaced with a mock."""
    svc = ComposioService(api_key="test-key")
    mock_client = _make_client(connected_slugs)
    # Bypass the cached_property by injecting directly into the instance dict
    svc.__dict__["_composio"] = mock_client
    return svc, mock_client


# ---------------------------------------------------------------------------
# Allow-list + risk map (no network)
# ---------------------------------------------------------------------------


class TestAllowList:
    def test_all_four_toolkits_defined(self):
        assert set(_ALLOW_LIST.keys()) == {"gmail", "googlecalendar", "notion", "slack"}

    def test_enabled_toolkits_are_gmail_and_calendar(self):
        # Only the apps that are BOTH live in the portal AND have chat actions.
        assert set(TOOLKITS) == {"gmail", "googlecalendar"}

    def test_enabled_toolkits_all_have_actions(self):
        # Every enabled toolkit must have action definitions (TOOLKITS ⊆ _ALLOW_LIST).
        assert set(TOOLKITS).issubset(set(_ALLOW_LIST.keys()))

    def test_each_toolkit_has_at_least_two_actions(self):
        for tk, actions in _ALLOW_LIST.items():
            assert len(actions) >= 2, f"{tk} has fewer than 2 actions"

    def test_risk_map_covers_all_allow_list_entries(self):
        for _tk, actions in _ALLOW_LIST.items():
            for slug, risk in actions:
                assert slug in _RISK_MAP, f"{slug} missing from _RISK_MAP"
                assert risk in ("low", "high"), f"{slug} has unknown risk {risk!r}"

    def test_high_risk_actions(self):
        high = {s for s, r in _RISK_MAP.items() if r == "high"}
        # These must be high-risk — outbound / irreversible-to-others
        assert "GMAIL_SEND_EMAIL" in high
        assert "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL" in high

    def test_low_risk_actions(self):
        low = {s for s, r in _RISK_MAP.items() if r == "low"}
        assert "GMAIL_FETCH_EMAILS" in low
        assert "GOOGLECALENDAR_EVENTS_LIST" in low
        assert "NOTION_SEARCH_NOTION_PAGE" in low
        assert "SLACK_LIST_CHANNELS" in low

    def test_allowed_slugs_frozenset(self):
        assert isinstance(_ALLOWED_SLUGS, frozenset)
        assert _ALLOWED_SLUGS == frozenset(_RISK_MAP.keys())


# ---------------------------------------------------------------------------
# ComposioService — no-key guard
# ---------------------------------------------------------------------------


class TestNoKeyGuard:
    def test_raises_when_no_key_set(self):
        svc = ComposioService()  # no api_key arg
        # Patch settings so composio_api_key is None
        with patch("stewardai.integrations.composio_service.get_settings") as mock_cfg:
            mock_cfg.return_value = SimpleNamespace(composio_api_key=None)
            with pytest.raises(RuntimeError, match="COMPOSIO_API_KEY"):
                # Access _composio to trigger lazy init
                _ = svc._composio  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# risk_of()
# ---------------------------------------------------------------------------


class TestRiskOf:
    def test_known_low(self):
        svc, _ = _service_with_mock()
        assert svc.risk_of("GMAIL_FETCH_EMAILS") == "low"

    def test_known_high(self):
        svc, _ = _service_with_mock()
        assert svc.risk_of("GMAIL_SEND_EMAIL") == "high"

    def test_unknown_slug_raises_key_error(self):
        svc, _ = _service_with_mock()
        with pytest.raises(KeyError, match="UNKNOWN_ACTION"):
            svc.risk_of("UNKNOWN_ACTION")

    def test_all_risk_map_entries_via_risk_of(self):
        svc, _ = _service_with_mock()
        for slug in _RISK_MAP:
            risk = svc.risk_of(slug)
            assert risk in ("low", "high")


# ---------------------------------------------------------------------------
# list_connected()
# ---------------------------------------------------------------------------


class TestListConnected:
    def test_returns_only_connected_toolkits(self):
        svc, mock_client = _service_with_mock(["gmail", "googlecalendar"])
        result = svc.list_connected("user-123")
        assert sorted(result) == ["gmail", "googlecalendar"]
        mock_client.connected_accounts.list.assert_called_once_with(
            user_ids=["user-123"],
            statuses=["ACTIVE"],
            toolkit_slugs=TOOLKITS,
        )

    def test_empty_when_nothing_connected(self):
        svc, _ = _service_with_mock([])
        assert svc.list_connected("user-abc") == []

    def test_deduplicates_multiple_accounts_same_toolkit(self):
        svc, mock_client = _service_with_mock([])
        # Two gmail accounts — should appear once
        items = [_make_account("gmail"), _make_account("gmail")]
        mock_client.connected_accounts.list.return_value = SimpleNamespace(items=items)
        result = svc.list_connected("user-x")
        assert result.count("gmail") == 1

    def test_ignores_non_toolkit_slugs(self):
        svc, mock_client = _service_with_mock([])
        items = [_make_account("github"), _make_account("gmail")]
        mock_client.connected_accounts.list.return_value = SimpleNamespace(items=items)
        result = svc.list_connected("user-x")
        # Only gmail is in TOOLKITS
        assert result == ["gmail"]

    def test_handles_toolkit_as_string_attribute(self):
        """Account with toolkit_slug attr instead of .toolkit.slug."""
        svc, mock_client = _service_with_mock([])
        acct = SimpleNamespace(toolkit_slug="googlecalendar", toolkit=None)
        mock_client.connected_accounts.list.return_value = SimpleNamespace(items=[acct])
        result = svc.list_connected("user-y")
        assert result == ["googlecalendar"]


# ---------------------------------------------------------------------------
# get_tools()
# ---------------------------------------------------------------------------


class TestGetTools:
    def test_returns_list_of_dicts(self):
        svc, _ = _service_with_mock(["gmail"])
        tools = svc.get_tools("user-1")
        assert isinstance(tools, list)
        for t in tools:
            assert isinstance(t, dict)

    def test_calls_tools_get_with_allowed_slugs(self):
        svc, mock_client = _service_with_mock(["gmail"])
        svc.get_tools("user-1")
        call_kwargs = mock_client.tools.get.call_args
        slugs_passed: list[str] = call_kwargs.kwargs.get("tools") or call_kwargs[1].get("tools", [])
        gmail_slugs = [s for s, _ in _ALLOW_LIST["gmail"]]
        assert set(slugs_passed) == set(gmail_slugs)

    def test_filters_by_toolkit_arg(self):
        svc, mock_client = _service_with_mock(["gmail", "slack"])
        svc.get_tools("user-1", toolkits=["gmail"])
        call_kwargs = mock_client.tools.get.call_args
        slugs_passed: list[str] = call_kwargs.kwargs.get("tools") or call_kwargs[1].get("tools", [])
        gmail_slugs = {s for s, _ in _ALLOW_LIST["gmail"]}
        slack_slugs = {s for s, _ in _ALLOW_LIST["slack"]}
        assert set(slugs_passed).issubset(gmail_slugs)
        assert not set(slugs_passed).intersection(slack_slugs)

    def test_returns_empty_when_nothing_connected(self):
        svc, _ = _service_with_mock([])
        assert svc.get_tools("user-2") == []

    def test_returns_empty_for_unconnected_toolkit_filter(self):
        svc, _ = _service_with_mock(["gmail"])
        result = svc.get_tools("user-3", toolkits=["notion"])
        assert result == []

    def test_only_connected_false_exposes_unconnected_toolkits(self):
        # gmail connected; googlecalendar (enabled) is NOT. With only_connected=
        # False the schema fetch still returns calendar tools (Composio serves
        # schemas without a live connection), so the agent can call one and trip
        # the connect gate — the "tool available but not authorized → ask to
        # connect" contract.
        svc, mock_client = _service_with_mock(["gmail"])
        mock_client.tools.get.side_effect = lambda user_id, tools: [
            {"type": "function", "function": {"name": s, "description": "t", "parameters": {}}}
            for s in tools
        ]
        names = {t["function"]["name"] for t in svc.get_tools("user-1", only_connected=False)}
        cal_slugs = {s for s, _ in _ALLOW_LIST["googlecalendar"]}
        assert cal_slugs.issubset(names)

    def test_only_connected_true_is_the_default_and_still_filters(self):
        # Default behavior unchanged: unconnected calendar yields no tools.
        svc, mock_client = _service_with_mock(["gmail"])
        mock_client.tools.get.side_effect = lambda user_id, tools: [
            {"type": "function", "function": {"name": s, "description": "t", "parameters": {}}}
            for s in tools
        ]
        names = {t["function"]["name"] for t in svc.get_tools("user-1")}
        cal_slugs = {s for s, _ in _ALLOW_LIST["googlecalendar"]}
        assert not cal_slugs.intersection(names)

    def test_schema_has_expected_openai_shape(self):
        svc, mock_client = _service_with_mock(["gmail"])
        # Return a properly shaped OpenAI dict
        mock_client.tools.get.return_value = [
            {
                "type": "function",
                "function": {
                    "name": "GMAIL_FETCH_EMAILS",
                    "description": "Fetch emails",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ]
        tools = svc.get_tools("user-1")
        assert len(tools) == 1
        tool = tools[0]
        assert tool["type"] == "function"
        assert "function" in tool
        assert "name" in tool["function"]


# ---------------------------------------------------------------------------
# execute()
# ---------------------------------------------------------------------------


class TestExecute:
    def test_execute_allowed_action(self):
        svc, mock_client = _service_with_mock(["gmail"])
        result = svc.execute("user-1", "GMAIL_FETCH_EMAILS", {"max_results": 5})
        mock_client.tools.execute.assert_called_once_with(
            slug="GMAIL_FETCH_EMAILS",
            arguments={"max_results": 5},
            user_id="user-1",
            dangerously_skip_version_check=True,
        )
        assert result["successful"] is True

    def test_execute_disallowed_action_raises(self):
        svc, _ = _service_with_mock(["gmail"])
        with pytest.raises(ValueError, match="allow-list"):
            svc.execute("user-1", "GMAIL_UNKNOWN_ACTION_XYZ", {})

    def test_execute_returns_dict(self):
        svc, mock_client = _service_with_mock(["gmail"])
        mock_client.tools.execute.return_value = {
            "data": {"emails": []},
            "error": None,
            "successful": True,
        }
        result = svc.execute("user-1", "GMAIL_FETCH_EMAILS", {})
        assert isinstance(result, dict)

    def test_execute_pydantic_result_converted(self):
        """If the SDK returns a Pydantic model, service converts it to dict."""
        from pydantic import BaseModel

        class FakeResult(BaseModel):
            data: dict = {}
            error: str | None = None
            successful: bool = True

        svc, mock_client = _service_with_mock(["gmail"])
        mock_client.tools.execute.return_value = FakeResult()
        result = svc.execute("user-1", "GMAIL_FETCH_EMAILS", {})
        assert isinstance(result, dict)
        assert result["successful"] is True

    def test_execute_high_risk_action_still_works(self):
        """Risk level is informational only — execute() doesn't block high risk."""
        svc, mock_client = _service_with_mock(["gmail"])
        result = svc.execute(
            "user-1", "GMAIL_SEND_EMAIL", {"to": "x@y.com", "subject": "hi", "body": "hello"}
        )
        assert mock_client.tools.execute.called
        assert result["successful"] is True


# ---------------------------------------------------------------------------
# Optional live smoke test (skipped when COMPOSIO_API_KEY not set)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.getenv("COMPOSIO_API_KEY"),
    reason="COMPOSIO_API_KEY not set — skipping live smoke test",
)
def test_live_list_connected_and_toolkits():
    """Live smoke test: verifies that the SDK can hit the Composio API.

    Creates a real Composio client and calls list_connected() for a
    sentinel user ID.  The call is expected to succeed (returning an empty
    list for a user with no connections) without raising.  Also asserts that
    toolkits.list() returns at least one toolkit so we know the key is valid.
    """
    from composio import Composio

    key = os.environ["COMPOSIO_API_KEY"]
    client = Composio(api_key=key)

    # list_connected for a non-existent user should return empty, not raise
    svc = ComposioService(api_key=key)
    connected = svc.list_connected("smoke-test-user-does-not-exist")
    assert isinstance(connected, list)

    # toolkits.list() should return at least one item
    response = client.toolkits.list()
    items = getattr(response, "items", [])
    assert len(items) > 0, "Expected at least one toolkit from the Composio API"


# ---------------------------------------------------------------------------
# _prepare_args: Google Calendar constraint shim
# ---------------------------------------------------------------------------

from stewardai.integrations.composio_service import _prepare_args  # noqa: E402


def test_prepare_args_focus_time_drops_meet_and_attendees():
    args = {
        "summary": "Focus",
        "start_datetime": "2026-07-02T14:00:00",
        "focusTimeProperties": {"autoDeclineMode": "declineAllConflictingInvitations"},
        "attendees": ["a@x.com"],
    }
    out = _prepare_args("GOOGLECALENDAR_CREATE_EVENT", args)
    assert out["create_meeting_room"] is False
    assert "attendees" not in out
    assert "focusTimeProperties" not in out  # downgraded to a normal event
    assert "attendees" in args  # original not mutated


def test_prepare_args_special_event_type():
    out = _prepare_args("GOOGLECALENDAR_CREATE_EVENT", {"eventType": "outOfOffice"})
    assert out["create_meeting_room"] is False
    assert "eventType" not in out  # enterprise-only type downgraded


def test_prepare_args_meeting_with_attendees_gets_meet_room():
    out = _prepare_args(
        "GOOGLECALENDAR_CREATE_EVENT", {"summary": "Sync", "attendees": ["a@x.com"]}
    )
    assert out["create_meeting_room"] is True


def test_prepare_args_solo_event_no_meet_room():
    out = _prepare_args("GOOGLECALENDAR_CREATE_EVENT", {"summary": "Block"})
    assert out["create_meeting_room"] is False


def test_prepare_args_explicit_flag_respected():
    out = _prepare_args(
        "GOOGLECALENDAR_CREATE_EVENT", {"summary": "x", "create_meeting_room": True}
    )
    assert out["create_meeting_room"] is True


def test_prepare_args_other_slug_untouched():
    args = {"foo": "bar"}
    assert _prepare_args("GMAIL_SEND_EMAIL", args) is args


def test_prepare_args_defaults_timezone_and_title():
    out = _prepare_args(
        "GOOGLECALENDAR_CREATE_EVENT",
        {"start_datetime": "2026-07-01T16:00:00"},
        "Asia/Karachi",
    )
    assert out["timezone"] == "Asia/Karachi"  # no more silent-UTC → wrong local time
    assert out["summary"] == "Event"           # never blank


def test_prepare_args_keeps_provided_timezone_and_title():
    out = _prepare_args(
        "GOOGLECALENDAR_CREATE_EVENT",
        {"timezone": "America/New_York", "summary": "Standup", "attendees": ["a@x.com"]},
        "Asia/Karachi",
    )
    assert out["timezone"] == "America/New_York"
    assert out["summary"] == "Standup"
