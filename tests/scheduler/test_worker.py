from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from standin.scheduler.worker import is_due, build_bot_payload


def _meeting(start_offset_s: float) -> dict:
    return {
        "id": "m-1",
        "user_id": "u-1",
        "meet_url": "https://meet.google.com/abc-defg-hij",
        "opted_in": True,
        "bot_status": "pending",
        "start_time": datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + start_offset_s,
            tz=timezone.utc,
        ).isoformat(),
    }


def test_is_due_within_window():
    assert is_due(_meeting(300))   # 5 min ahead — due
    assert is_due(_meeting(-60))   # 1 min ago — still due (join grace)


def test_is_due_outside_window():
    assert not is_due(_meeting(900))   # 15 min ahead — not yet
    assert not is_due(_meeting(-600))  # 10 min ago — missed


def test_build_bot_payload():
    meeting = _meeting(60)
    meeting["meet_url"] = "https://meet.google.com/abc-defg-hij"
    payload = build_bot_payload(meeting, bot_name="StewardAI")
    assert payload["meeting_url"] == "https://meet.google.com/abc-defg-hij"
    assert payload["bot_name"] == "StewardAI"
