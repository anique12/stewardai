"""The per-speaker tap must exclude the bot's OWN audio.

The bot's own participant audio is forwarded through `speaker_frames()` carrying
its room/account display name. If it reaches the SpeakerTracker it (a) surfaces
as a phantom participant in the transcript and (b) steals the label of the next
human turn (the tracker labels a finalized turn with the most-recently-active
speaker). `_tapped_speaker_frames` must drop frames whose name matches the bot's
configured label (case-insensitive) — neither tracking nor yielding them.
"""
from __future__ import annotations

from stewardai.agent.meeting_runner import _SPEAKER_KEY_SEP, MeetingSession
from stewardai.bridge.speaker_events import SpeakerTracker


class _FakeConn:
    def __init__(self, frames):
        self._frames = frames

    async def speaker_frames(self):
        for f in self._frames:
            yield f


def _key(name: str) -> str:
    return f"sid-{name}{_SPEAKER_KEY_SEP}{name}"


def _fake_session(conn, tracker, bot_label):
    s = MeetingSession.__new__(MeetingSession)
    s._conn = conn
    s._tracker = tracker
    s._bot_label = bot_label
    return s


async def test_tapped_frames_excludes_bot_own_audio():
    tracker = SpeakerTracker()
    frames = [(_key("Alice"), b"a"), (_key("MeetBase"), b"b"), (_key("Bob"), b"c")]
    s = _fake_session(_FakeConn(frames), tracker, "MeetBase")

    out = [item async for item in s._tapped_speaker_frames()]

    # The bot's frame is dropped: not yielded downstream (no phantom transcript)…
    yielded = [k.split(_SPEAKER_KEY_SEP, 1)[1] for k, _ in out]
    assert yielded == ["Alice", "Bob"]
    # …and never entered the tracker, so a human turn is labeled with a human.
    assert tracker.current_speaker() == "Bob"
    assert "MeetBase" not in tracker._open


async def test_tapped_frames_bot_match_is_case_insensitive():
    tracker = SpeakerTracker()
    frames = [(_key("meetbase"), b"b"), (_key("Carol"), b"c")]
    s = _fake_session(_FakeConn(frames), tracker, "MeetBase")

    out = [item async for item in s._tapped_speaker_frames()]

    assert [k.split(_SPEAKER_KEY_SEP, 1)[1] for k, _ in out] == ["Carol"]
    assert tracker.current_speaker() == "Carol"


async def test_tapped_frames_pass_humans_through_when_no_bot_label():
    tracker = SpeakerTracker()
    frames = [(_key("Dana"), b"d")]
    s = _fake_session(_FakeConn(frames), tracker, "")

    out = [item async for item in s._tapped_speaker_frames()]

    assert [k.split(_SPEAKER_KEY_SEP, 1)[1] for k, _ in out] == ["Dana"]
    assert tracker.current_speaker() == "Dana"
