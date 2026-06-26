"""Deterministic TTS stub — emits a quiet sine tone sized to the text. No heavy deps."""

from __future__ import annotations

from collections.abc import AsyncIterator

import numpy as np

from stewardai.common.audio import (
    SAMPLE_RATE,
    AudioFrame,
    chunk_pcm,
    pcm_from_float,
)

_FREQ = {"stub": 440.0, "stub-low": 330.0, "stub-high": 660.0}


class StubTTS:
    name = "stub"

    def __init__(self, settings: object | None = None) -> None:
        self._voices = list(_FREQ)

    @property
    def voices(self) -> list[str]:
        return list(self._voices)

    async def synthesize(
        self, text: str, *, voice: str | None = None
    ) -> AsyncIterator[AudioFrame]:
        words = max(1, len(text.split()))
        duration_s = min(5.0, 0.25 + 0.08 * words)
        n = int(SAMPLE_RATE * duration_s)
        freq = _FREQ.get(voice or "stub", 440.0)
        t = np.arange(n) / SAMPLE_RATE
        wave = (0.05 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
        pcm = pcm_from_float(wave)
        for frame in chunk_pcm(pcm):
            yield AudioFrame(pcm=frame)

    async def aclose(self) -> None:
        return None
