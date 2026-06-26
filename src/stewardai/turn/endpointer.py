"""Light, energy-based silence endpointer for the web pipeline (no heavy deps).

Feed fixed-size PCM frames; when speech is followed by enough silence, the buffered
utterance is returned. The production agent uses LiveKit's VAD + Turn Detector
instead; this keeps the browser test page dependency-free.
"""

from __future__ import annotations

from stewardai.common.audio import FRAME_MS, rms


class SilenceEndpointer:
    def __init__(
        self,
        *,
        silence_ms: int = 600,
        min_speech_ms: int = 200,
        threshold: float = 0.01,
        frame_ms: int = FRAME_MS,
    ) -> None:
        self._silence_frames = max(1, silence_ms // frame_ms)
        self._min_speech_frames = max(1, min_speech_ms // frame_ms)
        self._threshold = threshold
        self._reset()

    def _reset(self) -> None:
        self._buf: list[bytes] = []
        self._speech = 0
        self._silence = 0
        self._in_speech = False

    def feed(self, pcm: bytes) -> bytes | None:
        """Return a finalized utterance (PCM) on end-of-turn, else None."""
        is_speech = rms(pcm) >= self._threshold
        if is_speech:
            self._in_speech = True
            self._silence = 0
            self._speech += 1
            self._buf.append(pcm)
            return None

        if not self._in_speech:
            return None

        # trailing silence while in an utterance
        self._silence += 1
        self._buf.append(pcm)
        if self._silence >= self._silence_frames:
            utterance = b"".join(self._buf) if self._speech >= self._min_speech_frames else None
            self._reset()
            return utterance
        return None
