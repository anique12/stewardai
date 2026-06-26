"""Deterministic STT stub — no heavy deps. Used for dev/tests and the no-GPU path."""

from __future__ import annotations

from stewardai.common.audio import SAMPLE_RATE, Transcript

_DEFAULT_UTTERANCE = "Hello, can you hear me?"


class StubSTT:
    name = "stub"

    def __init__(self, settings: object | None = None, canned: str | None = None) -> None:
        self._canned = canned

    async def transcribe(
        self, pcm: bytes, *, sample_rate: int = SAMPLE_RATE, lang: str = "en"
    ) -> Transcript:
        text = self._canned if self._canned is not None else _DEFAULT_UTTERANCE
        return Transcript(text=text, is_final=True, confidence=1.0)

    async def aclose(self) -> None:
        return None
