# tests/agent/kb/test_teardown_wiring.py
from unittest.mock import AsyncMock, patch

from stewardai.agent.kb.teardown import run_kb_ingest


async def test_run_kb_ingest_builds_meta_and_calls_ingest():
    with patch("stewardai.agent.kb.teardown.ingest_meeting_kb", AsyncMock()) as ing:
        await run_kb_ingest(
            client="C", llm="L", user_id="u1", meeting_id="m1",
            transcript=["[a]: hi"],
            recurring_event_id="rec-1", attendee_emails=["jane@acme.com"], title="Acme sync",
        )
        ing.assert_awaited_once()
        kwargs = ing.await_args.kwargs
        assert kwargs["meeting_id"] == "m1"
        assert kwargs["meta"].recurring_event_id == "rec-1"
        assert kwargs["meta"].attendee_emails == ["jane@acme.com"]


async def test_run_kb_ingest_skips_when_no_user_or_meeting():
    with patch("stewardai.agent.kb.teardown.ingest_meeting_kb", AsyncMock()) as ing:
        await run_kb_ingest(client="C", llm="L", user_id=None, meeting_id="m1",
                            transcript=["x"], recurring_event_id=None,
                            attendee_emails=[], title="t")
        ing.assert_not_awaited()
