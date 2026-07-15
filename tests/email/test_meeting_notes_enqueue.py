from unittest.mock import AsyncMock, MagicMock

from stewardai.email import outbox


def _client():
    client = MagicMock()
    insert_chain = MagicMock()
    insert_chain.execute = AsyncMock(return_value=MagicMock(data=[{}]))
    table = MagicMock()
    table.insert.return_value = insert_chain
    client.table.return_value = table
    return client, insert_chain


def _settings(enabled=True):
    s = MagicMock()
    s.email_enabled = enabled
    return s


async def test_enqueue_meeting_notes_inserts_dedup_keyed_row():
    client, _ = _client()
    ok = await outbox.enqueue_meeting_notes(
        client, _settings(True),
        user_id="u-1", meeting_id="m-1", to_email="u@x.com", title="Standup",
    )
    assert ok is True
    payload = client.table.return_value.insert.call_args.args[0]
    assert payload["kind"] == "meeting_notes"
    assert payload["to_email"] == "u@x.com"
    assert payload["dedup_key"] == "meeting_notes:m-1:u@x.com"
    assert payload["meeting_id"] == "m-1"


async def test_enqueue_meeting_notes_noop_when_disabled():
    client, _ = _client()
    ok = await outbox.enqueue_meeting_notes(
        client, _settings(False),
        user_id="u-1", meeting_id="m-1", to_email="u@x.com", title="Standup",
    )
    assert ok is False
    client.table.return_value.insert.assert_not_called()
