"""The slow-reply filler must be synthesized as its OWN TTS segment.

Root cause of the "filler + answer merged/late" bug: LiveKit's default ``tts_node``
pushes the whole turn through ONE ``SynthesizeStream`` and only flushes at
``end_input``. A leading disfluent filler therefore sits in the sentence-tokenizer
buffer until later text confirms a boundary, so it is spoken glued onto (and delayed
until) the first real sentence of the reply.

``_synthesize_filler_aware`` fixes this by opening a SEPARATE stream for the filler so
it plays immediately, then a fresh stream for the reply. (Mid-stream ``flush()`` is not
an option: ``SynthesizeStream.push_text`` drops text pushed after a flush.)

These tests exercise the livekit-free core, so they run without the ``heavy`` extras.
"""

from __future__ import annotations

import pytest

from stewardai.agent.nodes import _synthesize_filler_aware
from stewardai.agent.tool_turn import _SLOW_FILLERS


class _FakeEv:
    def __init__(self, frame: str) -> None:
        self.frame = frame


class _FakeStream:
    """One synthesis segment: records pushed text, yields one frame per push."""

    def __init__(self, registry: list["_FakeStream"]) -> None:
        self.pushed: list[str] = []
        self._ended = False
        registry.append(self)

    async def __aenter__(self) -> "_FakeStream":
        return self

    async def __aexit__(self, *exc) -> None:  # noqa: ANN002
        return None

    def push_text(self, token: str) -> None:
        self.pushed.append(token)

    def end_input(self) -> None:
        self._ended = True

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        # Yield one frame per pushed chunk once input is finalized.
        while not self._ended:
            import asyncio

            await asyncio.sleep(0)
        for tok in self.pushed:
            yield _FakeEv(f"pcm:{tok}")


async def _text_stream(chunks: list[str]):
    for c in chunks:
        yield c


async def _run(chunks: list[str]) -> list["_FakeStream"]:
    streams: list[_FakeStream] = []
    frames: list[str] = []
    async for frame in _synthesize_filler_aware(
        _text_stream(chunks),
        open_stream=lambda: _FakeStream(streams),
        fillers=frozenset(_SLOW_FILLERS),
    ):
        frames.append(frame)
    # Frames must cover every chunk, in order, exactly once.
    assert frames == [f"pcm:{c}" for c in chunks]
    return streams


async def test_leading_filler_is_its_own_segment() -> None:
    filler = _SLOW_FILLERS[0]
    streams = await _run([filler, "The ", "answer ", "is 42."])
    assert len(streams) == 2, "filler and reply must be separate TTS streams"
    assert streams[0].pushed == [filler], "segment 1 is the filler alone"
    assert streams[1].pushed == ["The ", "answer ", "is 42."], "segment 2 is the reply"


async def test_no_filler_is_single_segment() -> None:
    streams = await _run(["The ", "answer ", "is 42."])
    assert len(streams) == 1, "a turn with no filler streams as one segment (unchanged)"
    assert streams[0].pushed == ["The ", "answer ", "is 42."]


async def test_empty_stream_synthesizes_nothing() -> None:
    streams = await _run([])
    assert streams == []
