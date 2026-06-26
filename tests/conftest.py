"""Shared test helpers."""

from __future__ import annotations

import numpy as np

from stewardai.common.audio import SAMPLE_RATE, SAMPLES_PER_FRAME, pcm_from_float


def speech_frame(freq: float = 440.0, amp: float = 0.3) -> bytes:
    """A 20 ms voiced-ish frame (s16le, 640 bytes)."""
    t = np.arange(SAMPLES_PER_FRAME) / SAMPLE_RATE
    return pcm_from_float((amp * np.sin(2 * np.pi * freq * t)).astype(np.float32))


def silence_frame() -> bytes:
    """A 20 ms silent frame (640 bytes)."""
    return b"\x00\x00" * SAMPLES_PER_FRAME
