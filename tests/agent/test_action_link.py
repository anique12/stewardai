"""Tests for close_agent_owned_items (auto-close MeetBase-owned action_items
that a done agent_action already fulfilled)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from stewardai.agent.action_link import close_agent_owned_items

MEETING = "11111111-1111-1111-1111-111111111111"


def _client(action_items_rows, agent_actions_rows):
    """A minimal fake Supabase client: action_items.select(...)... returns
    action_items_rows; agent_actions.select(...)... returns agent_actions_rows.
    Records every action_items.update(...) call for assertions."""
    updates: list[dict] = []

    def _select_chain(rows):
        chain = MagicMock()
        chain.eq.return_value = chain
        chain.is_.return_value = chain
        chain.execute = AsyncMock(return_value=MagicMock(data=rows))
        return chain

    def _update_chain(payload):
        updates.append(payload)
        chain = MagicMock()
        chain.eq.return_value = chain
        chain.execute = AsyncMock(return_value=MagicMock(data=[{}]))
        return chain

    action_items_table = MagicMock()
    action_items_table.select.return_value = _select_chain(action_items_rows)
    action_items_table.update.side_effect = _update_chain

    agent_actions_table = MagicMock()
    agent_actions_table.select.return_value = _select_chain(agent_actions_rows)

    client = MagicMock()

    def _table(name):
        if name == "action_items":
            return action_items_table
        if name == "agent_actions":
            return agent_actions_table
        raise AssertionError(f"unexpected table {name}")

    client.table.side_effect = _table
    return client, updates


async def test_closes_confident_single_match():
    items = [{"id": "ai-1", "task": "send the recap email to the team", "owner": "MeetBase"}]
    actions = [{"id": "aa-1", "action_slug": "GMAIL_SEND_EMAIL", "title": "Send email"}]
    client, updates = _client(items, actions)

    await close_agent_owned_items(client, MEETING, "MeetBase")

    assert len(updates) == 1
    payload = updates[0]
    assert payload["agent_action_id"] == "aa-1"
    assert payload["done"] is True
    assert payload["closed_by"] == "MeetBase"
    assert payload["closed_at"]  # ISO timestamp string, non-empty


async def test_ambiguous_multiple_matches_left_open():
    items = [{"id": "ai-1", "task": "send the recap email to the team", "owner": "MeetBase"}]
    actions = [
        {"id": "aa-1", "action_slug": "GMAIL_SEND_EMAIL", "title": "Send email"},
        {"id": "aa-2", "action_slug": "GMAIL_CREATE_EMAIL_DRAFT", "title": "Email draft"},
    ]
    client, updates = _client(items, actions)

    await close_agent_owned_items(client, MEETING, "MeetBase")

    assert updates == []


async def test_human_owned_item_untouched():
    # Owner isn't the bot label, so it should never even be considered — simulate
    # the DB-side filter by returning no rows (the real query filters by owner).
    client, updates = _client([], [{"id": "aa-1", "action_slug": "GMAIL_SEND_EMAIL", "title": "x"}])

    await close_agent_owned_items(client, MEETING, "MeetBase")

    assert updates == []


async def test_owner_match_is_case_insensitive():
    items = [
        {"id": "ai-1", "task": "send the recap email", "owner": "meetbase"},
        {"id": "ai-2", "task": "buy milk", "owner": "Anique"},
    ]
    actions = [{"id": "aa-1", "action_slug": "GMAIL_SEND_EMAIL", "title": "Send email"}]
    client, updates = _client(items, actions)

    await close_agent_owned_items(client, MEETING, "MeetBase")

    # Only the bot-owned row should be closed; "buy milk" (owner Anique) is
    # filtered out by _fetch_open_bot_items before matching ever runs.
    assert len(updates) == 1


async def test_no_match_leaves_item_open():
    items = [{"id": "ai-1", "task": "buy office snacks", "owner": "MeetBase"}]
    actions = [{"id": "aa-1", "action_slug": "GMAIL_SEND_EMAIL", "title": "Send email"}]
    client, updates = _client(items, actions)

    await close_agent_owned_items(client, MEETING, "MeetBase")

    assert updates == []


async def test_guarded_against_fetch_failure():
    client = MagicMock()
    client.table.side_effect = RuntimeError("boom")

    # Must not raise.
    await close_agent_owned_items(client, MEETING, "MeetBase")


async def test_noop_without_meeting_uuid_or_label():
    client = MagicMock()
    await close_agent_owned_items(client, "", "MeetBase")
    await close_agent_owned_items(client, MEETING, "")
    client.table.assert_not_called()
