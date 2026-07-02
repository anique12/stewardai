"""Tests for PerSpeakerTranscriber (per-speaker segment -> attributed transcript)."""
from __future__ import annotations

from types import SimpleNamespace

from stewardai.agent.per_speaker_transcriber import PerSpeakerTranscriber


async def _aiter(items):
    for it in items:
        yield it


def _stt(mapping=None, *, raise_on=None):
    """Mock STT backend: returns text via mapping keyed by pcm bytes; records calls."""

    class _STT:
        def __init__(self):
            self.calls = []

        async def transcribe(self, pcm, *, sample_rate=16_000, lang="en"):
            self.calls.append(pcm)
            if raise_on is not None and pcm == raise_on:
                raise RuntimeError("stt boom")
            return SimpleNamespace(text=(mapping or {}).get(pcm, ""))

    return _STT()


async def test_appends_attributed_lines_in_order():
    a, b = b"\xaa" * 8000, b"\xbb" * 8000
    stt = _stt({a: "hello there", b: "hi"})
    transcript: list[str] = []
    await PerSpeakerTranscriber(stt, transcript).run(_aiter([("Alice", a), ("Bob", b)]))
    assert transcript == ["[Alice]: hello there", "[Bob]: hi"]


async def test_skips_short_pcm_and_empty_text():
    ok, empty, short = b"\xaa" * 8000, b"\xbb" * 8000, b"\xcc" * 100
    stt = _stt({ok: "real", empty: "   "})  # empty text after strip -> skipped
    transcript: list[str] = []
    await PerSpeakerTranscriber(stt, transcript).run(
        _aiter([("A", short), ("A", ok), ("B", empty)])
    )
    assert transcript == ["[A]: real"]
    assert short not in stt.calls  # sub-100ms segment never hits STT


async def test_stt_exception_skips_segment_not_loop():
    bad, ok = b"\xaa" * 8000, b"\xbb" * 8000
    stt = _stt({ok: "survived"}, raise_on=bad)
    transcript: list[str] = []
    await PerSpeakerTranscriber(stt, transcript).run(_aiter([("A", bad), ("B", ok)]))
    assert transcript == ["[B]: survived"]  # loop survived the raising segment
