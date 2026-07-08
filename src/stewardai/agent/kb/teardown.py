# src/stewardai/agent/kb/teardown.py
"""Thin adapter called from MeetingSession.teardown() so the wiring is unit-testable."""
from __future__ import annotations

from stewardai.agent.kb.ingest import MeetingMeta, ingest_meeting_kb
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.teardown")


async def run_kb_ingest(*, client, llm, user_id: str | None, meeting_id: str | None,
                        transcript: list[str], recurring_event_id: str | None,
                        attendee_emails: list[str], title: str) -> None:
    if not user_id or not meeting_id or not transcript:
        _log.info("kb_ingest_skipped", have_user=bool(user_id), have_meeting=bool(meeting_id))
        return
    meta = MeetingMeta(recurring_event_id=recurring_event_id,
                       attendee_emails=attendee_emails or [], title=title or "")
    await ingest_meeting_kb(client, llm, user_id=user_id, meeting_id=meeting_id,
                            transcript=transcript, meta=meta)
