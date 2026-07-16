"""_merge_attendee_photos must retry the Vexa fetch.

Vexa builds participant_details asynchronously after the meeting, so the first
fetch(es) commonly return {}. The merge must poll a few times and apply the
images once they appear, rather than giving up after one empty fetch.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from stewardai.agent import meeting_runner as mr
from stewardai.agent.meeting_runner import MeetingSession


def _fake_session():
    s = MeetingSession.__new__(MeetingSession)
    s._supabase = object()
    s._meeting_uuid = "mu-1"
    s.native_meeting_id = "abc"
    s._mid = "1"
    s._s = type(
        "S",
        (),
        {"vexa_gateway_url": "http://gw", "vexa_api_key": "k", "vexa_platform": "google_meet"},
    )()
    s._apply_participant_images = AsyncMock()
    return s


async def test_merge_retries_until_images_appear():
    s = _fake_session()
    fake_vexa = AsyncMock()
    # Empty twice (aggregation not ready), then a real map.
    fake_vexa.fetch_participant_images = AsyncMock(
        side_effect=[{}, {}, {"Alex": "https://lh3.googleusercontent.com/x"}]
    )
    with patch("stewardai.bridge.vexa_client.VexaClient", return_value=fake_vexa), \
         patch.object(mr.asyncio, "sleep", AsyncMock()):
        await s._merge_attendee_photos()

    assert fake_vexa.fetch_participant_images.await_count == 3
    s._apply_participant_images.assert_awaited_once_with(
        {"Alex": "https://lh3.googleusercontent.com/x"}
    )


async def test_merge_gives_up_after_max_attempts_when_always_empty():
    s = _fake_session()
    fake_vexa = AsyncMock()
    fake_vexa.fetch_participant_images = AsyncMock(return_value={})
    with patch("stewardai.bridge.vexa_client.VexaClient", return_value=fake_vexa), \
         patch.object(mr.asyncio, "sleep", AsyncMock()):
        await s._merge_attendee_photos()

    assert fake_vexa.fetch_participant_images.await_count == mr._PARTICIPANT_IMAGE_ATTEMPTS
    s._apply_participant_images.assert_not_awaited()
