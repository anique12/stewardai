"""Tests for DeepgramSpeakerTranscriber (mocked STT/stream — no network)."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

pytest.importorskip("livekit.agents")
pytest.importorskip("livekit.rtc")

from livekit.agents.stt import SpeechEventType  # noqa: E402

from stewardai.agent.deepgram_speaker_transcriber import (  # noqa: E402
    DeepgramSpeakerTranscriber,
)


class _MockStream:
    def __init__(self, events):
        self._events = events
        self.pushed = 0
        self.ended = False
        self.closed = False

    def push_frame(self, frame):
        self.pushed += 1

    def end_input(self):
        self.ended = True

    async def aclose(self):
        self.closed = True

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for ev in self._events:
            yield ev


class _MockSTT:
    def __init__(self, events):
        self._events = events

    def stream(self):
        return _MockStream(self._events)

    async def aclose(self):
        pass


def _final(text):
    return SimpleNamespace(
        type=SpeechEventType.FINAL_TRANSCRIPT,
        alternatives=[SimpleNamespace(text=text)],
    )


def _interim(text):
    return SimpleNamespace(
        type=SpeechEventType.INTERIM_TRANSCRIPT,
        alternatives=[SimpleNamespace(text=text)],
    )


async def _aiter(items):
    for it in items:
        yield it


PCM = b"\xaa" * 8000  # > _MIN_PCM_BYTES (1920)


async def test_attributes_by_name_and_builds_keyterms():
    seen_keyterms: list[list[str]] = []

    def factory(kt):
        seen_keyterms.append(list(kt))
        return _MockSTT([_interim("hel"), _final("hello there")])

    transcript: list[str] = []
    # The wake name is passed in via extra_keyterms (not hardcoded), e.g. the owner's
    # configured display name; participant names are added dynamically as they speak.
    t = DeepgramSpeakerTranscriber(
        factory, transcript, extra_keyterms=["MyAgent", "Acme"]
    )
    await t.run(_aiter([("speaker-0\x1fAlice", PCM)]))

    assert transcript == ["[Alice]: hello there"]  # interim ignored, final kept
    kt = seen_keyterms[0]
    assert "MyAgent" in kt and "Acme" in kt and "Alice" in kt
    assert "Steward" not in kt  # wake name is NOT hardcoded — it comes from the caller


async def test_stable_id_keying_survives_name_resolving_late():
    """First chunk has no name (""), later chunks resolve to "Bob" — both must feed
    ONE stream (keyed by id) and the line is labeled with the resolved name."""
    streams: list[_MockStream] = []

    def factory(kt):
        s = _MockSTT([_final("second half")])
        orig = s.stream

        def _wrapped():
            st = orig()
            streams.append(st)
            return st

        s.stream = _wrapped
        return s

    transcript: list[str] = []
    t = DeepgramSpeakerTranscriber(factory, transcript)
    await t.run(
        _aiter([("speaker-1\x1f", PCM), ("speaker-1\x1fBob", PCM)])
    )
    assert len(streams) == 1  # one stream for the id, not two
    assert transcript == ["[Bob]: second half"]  # labeled with the resolved name


async def test_missing_name_falls_back_to_speaker():
    def factory(kt):
        return _MockSTT([_final("anon line")])

    transcript: list[str] = []
    await DeepgramSpeakerTranscriber(factory, transcript).run(
        _aiter([("speaker-2\x1f", PCM)])
    )
    assert transcript == ["[Speaker]: anon line"]
