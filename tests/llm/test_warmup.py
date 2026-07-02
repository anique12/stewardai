"""TTS connection warmup — moves the ~12s cold-websocket cost off the first reply."""

from __future__ import annotations

from stewardai.llm.warmup import warmup_tts


class _Stream:
    def __init__(self, frames: int) -> None:
        self._frames = frames
        self.closed = False

    def __aiter__(self):
        async def _gen():
            for _ in range(self._frames):
                yield object()

        return _gen()

    async def aclose(self) -> None:
        self.closed = True


class _TTS:
    def __init__(self, frames: int = 2, raise_exc: Exception | None = None) -> None:
        self.calls = 0
        self._frames = frames
        self._raise = raise_exc
        self.last_stream: _Stream | None = None

    def synthesize(self, text: str):  # noqa: ANN201 - livekit-plugin-like
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        self.last_stream = _Stream(self._frames)
        return self.last_stream


async def test_warmup_tts_drains_one_frame_and_closes():
    """Draining a single frame is enough to establish the connection; the stream
    is then closed (throwaway audio discarded, never routed to the meeting)."""
    tts = _TTS(frames=5)
    await warmup_tts(tts, quiet=True)
    assert tts.calls == 1
    assert tts.last_stream is not None and tts.last_stream.closed is True


async def test_warmup_tts_none_is_noop():
    await warmup_tts(None)  # must not raise


async def test_warmup_tts_swallows_synthesize_errors():
    """A failed/unsupported warmup (e.g. stub TTS) must never break the session."""
    await warmup_tts(_TTS(raise_exc=RuntimeError("boom")), quiet=True)  # no raise
