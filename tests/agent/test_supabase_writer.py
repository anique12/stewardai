from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, call

import pytest

from standin.agent.supabase_writer import SupabaseWriter


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
