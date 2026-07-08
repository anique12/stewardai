from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, call

import pytest

from standin.agent.supabase_writer import SupabaseWriter
from stewardai.agent.actions import AgentActionsWriter


def _mock_client() -> MagicMock:
    client = MagicMock()
    table = MagicMock()
    chain = MagicMock()
    chain.execute = AsyncMock(return_value=MagicMock(data=[{}]))
    table.insert.return_value = chain
    table.upsert.return_value = chain
    table.update.return_value.eq.return_value = chain
    client.table.return_value = table
    return client


@pytest.mark.asyncio
async def test_append_segment_calls_upsert():
    client = _mock_client()
    writer = SupabaseWriter(meeting_id="m-1", client=client)
    await writer.append_segment(seq=0, speaker="Alice", text="Hello")
    client.table.assert_called_with("transcript_segments")
    client.table().upsert.assert_called_once()
    payload = client.table().upsert.call_args[0][0]
    assert payload["meeting_id"] == "m-1"
    assert payload["seq"] == 0
    assert payload["speaker"] == "Alice"
    assert payload["text"] == "Hello"


@pytest.mark.asyncio
async def test_set_bot_status_calls_update():
    client = _mock_client()
    writer = SupabaseWriter(meeting_id="m-1", client=client)
    await writer.set_bot_status("done")
    client.table.assert_called_with("meetings")
    client.table().update.assert_called_with({"bot_status": "done"})


# ---------------------------------------------------------------------------
# AgentActionsWriter tests
# ---------------------------------------------------------------------------


class _FakeTable:
    def __init__(self, sink):
        self._sink = sink

    def insert(self, row):
        self._sink["row"] = row
        return self

    async def execute(self):
        class R:
            data = [{"id": "row-1"}]

        return R()


class _FakeClient:
    def __init__(self):
        self.sink = {}

    def table(self, name):
        return _FakeTable(self.sink)


@pytest.mark.asyncio
async def test_insert_includes_source_seq_when_provided():
    client = _FakeClient()
    w = AgentActionsWriter(meeting_id="m1", user_id="u1", client=client)
    await w.insert(
        source="directed",
        toolkit="gmail",
        action_slug="GMAIL_SEND_EMAIL",
        args={},
        risk="low",
        title="Send",
        state="done",
        source_seq=3,
    )
    assert client.sink["row"]["source_seq"] == 3


@pytest.mark.asyncio
async def test_insert_omits_source_seq_when_none():
    client = _FakeClient()
    w = AgentActionsWriter(meeting_id="m1", user_id="u1", client=client)
    await w.insert(
        source="directed",
        toolkit="gmail",
        action_slug="GMAIL_SEND_EMAIL",
        args={},
        risk="low",
        title="Send",
        state="done",
    )
    assert "source_seq" not in client.sink["row"]
