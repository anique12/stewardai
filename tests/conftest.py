"""Shared test fixtures.

Exposed as fixtures (not module-level imports) so they're discovered by pytest
by path — robust even if another installed package ships a top-level `tests`
module that would otherwise shadow `tests.conftest`.
"""

from __future__ import annotations

import numpy as np
import pytest

from stewardai.common.audio import SAMPLE_RATE, SAMPLES_PER_FRAME, pcm_from_float


def _speech_frame(freq: float = 440.0, amp: float = 0.3) -> bytes:
    """A 20 ms voiced-ish frame (s16le, 640 bytes)."""
    t = np.arange(SAMPLES_PER_FRAME) / SAMPLE_RATE
    return pcm_from_float((amp * np.sin(2 * np.pi * freq * t)).astype(np.float32))


def _silence_frame() -> bytes:
    """A 20 ms silent frame (640 bytes)."""
    return b"\x00\x00" * SAMPLES_PER_FRAME


@pytest.fixture
def speech_frame():
    """Factory: call speech_frame() in a test to get a 20 ms voiced frame."""
    return _speech_frame


@pytest.fixture
def silence_frame():
    """Factory: call silence_frame() in a test to get a 20 ms silent frame."""
    return _silence_frame
