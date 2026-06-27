"""Light, energy-based silence endpointer for the web test pages (no heavy deps).

Feed fixed-size PCM frames; when speech is followed by enough silence, the buffered
**speech** (trailing silence trimmed, minus a small tail pad) is returned. Trimming
matters: ASR models hallucinate words on trailing silence/low-level noise.

NOTE: this is an energy gate — robust enough for the test pages, but a real VAD
(Silero) is the correct tool and is what the production agent uses. v2 wires Silero
VAD here too.
"""

from __future__ import annotations

from stewardai.common.audio import FRAME_MS, rms


class SilenceEndpointer:
    def __init__(
        self,
        *,
        silence_ms: int = 600,
        min_speech_ms: int = 250,
        threshold: float = 0.02,
        tail_pad_ms: int = 60,
        frame_ms: int = FRAME_MS,
    ) -> None:
        self._silence_frames = max(1, silence_ms // frame_ms)
        self._min_speech_frames = max(1, min_speech_ms // frame_ms)
        self._pad_frames = max(0, tail_pad_ms // frame_ms)
        self._threshold = threshold
        self._reset()

    def _reset(self) -> None:
        self._buf: list[bytes] = []
        self._speech = 0
        self._silence = 0
        self._in_speech = False
        self._last_speech_idx = -1

    def feed(self, pcm: bytes) -> bytes | None:
        """Return a finalized utterance (speech only, trailing silence trimmed) or None."""
        is_speech = rms(pcm) >= self._threshold
        if is_speech:
            self._in_speech = True
            self._silence = 0
            self._speech += 1
            self._buf.append(pcm)
            self._last_speech_idx = len(self._buf) - 1
            return None

        if not self._in_speech:
            return None

        # trailing silence while in an utterance
        self._silence += 1
        self._buf.append(pcm)
        if self._silence >= self._silence_frames:
            if self._speech >= self._min_speech_frames:
                end = min(len(self._buf), self._last_speech_idx + 1 + self._pad_frames)
                utterance = b"".join(self._buf[:end])  # trim trailing silence (keep small pad)
            else:
                utterance = None
            self._reset()
            return utterance
        return None
