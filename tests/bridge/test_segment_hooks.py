"""Unit tests for QueueAudioOutput.on_segment_start / on_segment_end hooks.

No livekit or heavy deps required — the QueueAudioOutput factory path that
falls back to ``object`` as a base class is exercised here.
"""

from __future__ import annotations

import asyncio

from stewardai.bridge.audio_output import QueueAudioOutput
from stewardai.common.audio import SAMPLE_RATE, AudioFrame

# 10 ms of silence at 16 kHz, s16le → 320 bytes
_SILENT_FRAME = AudioFrame(pcm=b"\x00\x00" * 160, sample_rate=SAMPLE_RATE)


def _drain(ao: QueueAudioOutput) -> list[AudioFrame]:
    """Synchronously drive paced_frames() to completion and return frames."""

    async def _run() -> list[AudioFrame]:
        frames: list[AudioFrame] = []
        async for f in ao.paced_frames(lookahead=0.0):
            frames.append(f)
        return frames

    return asyncio.run(_run())


# ---------------------------------------------------------------------------
# Single segment: one frame → flush → close
# ---------------------------------------------------------------------------


def test_segment_hooks_fire_once_per_segment() -> None:
    ao = QueueAudioOutput(label="test")

    starts: list[int] = []
    ends: list[int] = []
    ao.on_segment_start = lambda: starts.append(1)
    ao.on_segment_end = lambda: ends.append(1)

    asyncio.run(ao.capture_frame(_SILENT_FRAME))
    ao.flush()
    asyncio.run(ao.aclose())

    frames = _drain(ao)

    assert len(frames) == 1
    assert len(starts) == 1, "on_segment_start should fire exactly once"
    assert len(ends) == 1, "on_segment_end should fire exactly once"


# ---------------------------------------------------------------------------
# Two segments: frame+flush, frame+flush, then close
# ---------------------------------------------------------------------------


def test_segment_hooks_fire_per_segment_two_segments() -> None:
    ao = QueueAudioOutput(label="test")

    starts: list[int] = []
    ends: list[int] = []
    ao.on_segment_start = lambda: starts.append(1)
    ao.on_segment_end = lambda: ends.append(1)

    # Segment 1
    asyncio.run(ao.capture_frame(_SILENT_FRAME))
    ao.flush()
    # Segment 2
    asyncio.run(ao.capture_frame(_SILENT_FRAME))
    ao.flush()
    asyncio.run(ao.aclose())

    frames = _drain(ao)

    assert len(frames) == 2
    assert len(starts) == 2, "on_segment_start should fire once per segment"
    assert len(ends) == 2, "on_segment_end should fire once per segment"


# ---------------------------------------------------------------------------
# Hooks default to None — existing behaviour is unchanged
# ---------------------------------------------------------------------------


def test_no_hooks_no_error() -> None:
    ao = QueueAudioOutput(label="test")
    # on_segment_start / on_segment_end are None by default
    assert ao.on_segment_start is None
    assert ao.on_segment_end is None

    asyncio.run(ao.capture_frame(_SILENT_FRAME))
    ao.flush()
    asyncio.run(ao.aclose())

    frames = _drain(ao)
    assert len(frames) == 1


# ---------------------------------------------------------------------------
# on_segment_start fires on FIRST frame only (not every frame in a segment)
# ---------------------------------------------------------------------------


def test_segment_start_fires_once_for_multi_frame_segment() -> None:
    ao = QueueAudioOutput(label="test")

    starts: list[int] = []
    ao.on_segment_start = lambda: starts.append(1)

    for _ in range(3):
        asyncio.run(ao.capture_frame(_SILENT_FRAME))
    ao.flush()
    asyncio.run(ao.aclose())

    frames = _drain(ao)

    assert len(frames) == 3
    assert len(starts) == 1, "on_segment_start must fire only on the first frame of each segment"
