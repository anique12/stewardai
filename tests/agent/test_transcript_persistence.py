"""Transcript reliability seams on MeetingSession (no livekit AgentSession).

These lock two fixes for the "portal transcript is blank / has one line" failure
observed in a live meeting (meeting 145: per-speaker path produced 0 finals, so
the portal showed nothing during the meeting and only 1 segment at teardown):

  * live persistence is driven by the RELIABLE combined transcript (a single
    monotonic seq across human + bot turns), not by the best-effort per-speaker
    path that may produce nothing.
  * ``_transcript_for_output`` must never let a shorter attributed transcript
    (e.g. a single bot reply) shadow the complete combined transcript.

MeetingSession.__init__ does not import livekit (that is lazy in build()/start()),
so we can construct it directly and exercise these seams without a real session.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from stewardai.config import Settings


def _bare_session(supabase=None):  # noqa: ANN001
    from stewardai.agent.meeting_runner import MeetingSession

    return MeetingSession(
        Settings(redis_url="redis://localhost:6379"),
        meeting_id=7,
        native_meeting_id="native-7",
        user_id="u-7",
        conn=MagicMock(),
        stt_backend=MagicMock(),
        llm_backend=MagicMock(),
        tts_backend=MagicMock(),
        composio_service=None,
        supabase_client=supabase,
    )


def test_transcript_for_output_prefers_more_complete():
    """A stray attributed line (one bot reply when the per-speaker path produced
    nothing) must NOT shadow the full combined transcript — otherwise the entire
    human conversation is dropped from the summary + final persist."""
    session = _bare_session()
    session._transcript = ["[Anique]: hi", "[Anique]: you there?", "[Steward]: Hello!"]
    session._attributed_transcript = ["[Steward]: Hello!"]  # per-speaker got nothing
    assert session._transcript_for_output() == session._transcript
    # When the attributed transcript is at least as complete, prefer it (real names).
    session._attributed_transcript = list(session._transcript)
    assert session._transcript_for_output() == session._attributed_transcript


async def test_persist_live_line_orders_and_parses(monkeypatch):
    """Live persistence assigns ONE monotonic seq across turns and splits the
    '[Speaker]: text' label into (speaker, text). Empty/blank lines are skipped
    and do NOT consume a seq."""
    calls: list = []

    async def _fake_persist(client, uuid, seq, speaker, text):  # noqa: ANN001
        calls.append((seq, speaker, text))

    import stewardai.agent.persistence as persistence

    monkeypatch.setattr(persistence, "persist_transcript_segment", _fake_persist)

    session = _bare_session(supabase=MagicMock())
    session._meeting_uuid = "uuid-7"
    await session._persist_live_line("[Anique]: hello there")
    await session._persist_live_line("[Steward]: Hi!")
    await session._persist_live_line("   ")  # blank -> skipped, seq not consumed
    await session._persist_live_line("no-brackets line")
    assert calls == [
        (0, "Anique", "hello there"),
        (1, "Steward", "Hi!"),
        (2, "Speaker", "no-brackets line"),
    ]


async def test_persist_live_line_noop_without_uuid(monkeypatch):
    """No resolved meetings.id UUID -> nothing persists (transcript_segments.meeting_id
    is a uuid FK; writing without it would fail every insert)."""
    calls: list = []

    async def _fake_persist(*a, **k):  # noqa: ANN001
        calls.append(a)

    import stewardai.agent.persistence as persistence

    monkeypatch.setattr(persistence, "persist_transcript_segment", _fake_persist)

    session = _bare_session(supabase=MagicMock())
    session._meeting_uuid = None
    await session._persist_live_line("[Anique]: hello")
    assert calls == []


async def test_record_bot_line_persists_via_unified_seq(monkeypatch):
    """Steward's own replies persist live through the SAME seq counter as human
    turns (so ordering is correct) and are captured in both transcripts."""
    calls: list = []

    async def _fake_persist(client, uuid, seq, speaker, text):  # noqa: ANN001
        calls.append((seq, speaker, text))

    import stewardai.agent.persistence as persistence
    import stewardai.agent.summary as summary

    monkeypatch.setattr(persistence, "persist_transcript_segment", _fake_persist)
    monkeypatch.setattr(summary, "append_transcript_line", lambda *a, **k: None)

    session = _bare_session(supabase=MagicMock())
    session._meeting_uuid = "uuid-7"
    session._bot_label = "Steward"
    await session._persist_live_line("[Anique]: are you there")  # seq 0 (human)
    await session._record_bot_line("Yes, I'm here")  # seq 1 (bot)
    assert calls == [
        (0, "Anique", "are you there"),
        (1, "Steward", "Yes, I'm here"),
    ]
    assert session._transcript[-1] == "[Steward]: Yes, I'm here"
    assert session._attributed_transcript[-1] == "[Steward]: Yes, I'm here"


def test_speaker_tracker_note_active():
    """note_active marks the most-recently-active speaker (used when only a
    per-speaker audio stream with a name is available — no start/end events)."""
    from stewardai.bridge.speaker_events import SpeakerTracker

    t = SpeakerTracker()
    assert t.current_speaker() is None
    t.note_active("Anique Sabir")
    assert t.current_speaker() == "Anique Sabir"
    t.note_active("Bob")
    assert t.current_speaker() == "Bob"
    t.note_active("Anique Sabir")  # most-recent wins again
    assert t.current_speaker() == "Anique Sabir"
    t.note_active("   ")  # blank ignored
    assert t.current_speaker() == "Anique Sabir"


async def test_tapped_speaker_frames_updates_tracker_and_passes_through():
    """The per-speaker frame tap feeds each frame's carried NAME into the tracker
    (so the combined transcript labels real names) and passes frames unchanged."""
    from stewardai.bridge.speaker_events import SpeakerTracker

    async def _fake_frames():
        yield ("spk-0\x1fAnique Sabir", b"\x00\x00")
        yield ("spk-0\x1fAnique Sabir", b"\x01\x01")

    session = _bare_session()
    session._tracker = SpeakerTracker()
    session._conn = MagicMock()
    session._conn.speaker_frames = _fake_frames

    out = []
    async for key, pcm in session._tapped_speaker_frames():
        out.append((key, pcm))

    assert session._tracker.current_speaker() == "Anique Sabir"
    assert out == [("spk-0\x1fAnique Sabir", b"\x00\x00"), ("spk-0\x1fAnique Sabir", b"\x01\x01")]


async def test_consume_speaker_names_attributes_without_deepgram():
    """Fully-local path (no Deepgram per-speaker transcriber): the name-only
    consumer still feeds the SpeakerTracker from the per-speaker frames, so the
    combined transcript is attributed with real names."""
    from stewardai.bridge.speaker_events import SpeakerTracker

    async def _fake_frames():
        yield ("spk-0\x1fAnique Sabir", b"\x00\x00")
        yield ("spk-1\x1fBob", b"\x01\x01")

    session = _bare_session()
    session._tracker = SpeakerTracker()
    session._conn = MagicMock()
    session._conn.speaker_frames = _fake_frames

    await session._consume_speaker_names()
    assert session._tracker.current_speaker() == "Bob"  # most-recently active
