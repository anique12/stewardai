"""Audio primitives and conversion helpers.

Canonical format across the whole system: PCM s16le, 16 kHz, mono, ~20 ms frames.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

import numpy as np

SAMPLE_RATE = 16_000
CHANNELS = 1
FRAME_MS = 20
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000  # 320
BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2             # 640 (s16le)


@dataclass(slots=True)
class AudioFrame:
    """A chunk of PCM audio (s16le, mono)."""

    pcm: bytes
    sample_rate: int = SAMPLE_RATE

    @property
    def num_samples(self) -> int:
        return len(self.pcm) // 2

    @property
    def duration_ms(self) -> float:
        return 1000.0 * self.num_samples / self.sample_rate


@dataclass(slots=True)
class Transcript:
    text: str
    is_final: bool = True
    confidence: float | None = None
    t_start_ms: float | None = None
    t_end_ms: float | None = None


@dataclass(slots=True)
class Message:
    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass(slots=True)
class Conversation:
    """Rolling message history for the LLM."""

    messages: list[Message] = field(default_factory=list)

    def add(self, role: str, content: str) -> None:
        self.messages.append(Message(role=role, content=content))


def float_from_pcm(pcm: bytes) -> np.ndarray:
    """s16le bytes -> float32 array in [-1, 1]."""
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def pcm_from_float(arr: np.ndarray) -> bytes:
    """float array in [-1, 1] -> s16le bytes."""
    clipped = np.clip(arr, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def chunk_pcm(pcm: bytes, frame_bytes: int = BYTES_PER_FRAME) -> Iterator[bytes]:
    """Yield fixed-size PCM frames; the final frame may be shorter."""
    for i in range(0, len(pcm), frame_bytes):
        yield pcm[i : i + frame_bytes]


def resample_linear(arr: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Simple linear resample (adequate for stubs/tests; real backends use better)."""
    if src_rate == dst_rate or arr.size == 0:
        return arr.astype(np.float32)
    duration = arr.size / src_rate
    dst_n = int(round(duration * dst_rate))
    if dst_n <= 0:
        return np.zeros(0, dtype=np.float32)
    src_idx = np.linspace(0, arr.size - 1, num=dst_n)
    return np.interp(src_idx, np.arange(arr.size), arr).astype(np.float32)


def rms(pcm: bytes) -> float:
    """Root-mean-square amplitude of an s16le buffer, in [0, 1]."""
    if not pcm:
        return 0.0
    return float(np.sqrt(np.mean(float_from_pcm(pcm) ** 2)))
