"""SinkPlayer fallback-to-WAV test (paplay forced absent; no heavy deps)."""

from __future__ import annotations

import shutil
from collections.abc import AsyncIterator

import numpy as np
import soundfile as sf

from stewardai.bridge import audio_output
from stewardai.bridge.audio_output import SinkPlayer
from stewardai.common.audio import SAMPLES_PER_FRAME, AudioFrame, pcm_from_float


async def _two_frames() -> AsyncIterator[AudioFrame]:
    t = np.arange(SAMPLES_PER_FRAME) / 16000.0
    pcm = pcm_from_float((0.1 * np.sin(2 * np.pi * 440 * t)).astype(np.float32))
    for _ in range(2):
        yield AudioFrame(pcm=pcm)


async def test_play_falls_back_to_wav_when_paplay_absent(tmp_path, monkeypatch):
    # Force the fallback path: pretend paplay is not installed.
    monkeypatch.setattr(audio_output.shutil, "which", lambda _name: None)
    assert shutil.which  # sanity: real shutil still importable

    wav = tmp_path / "out.wav"
    player = SinkPlayer(fallback_wav=str(wav))
    await player.play(_two_frames())

    assert wav.exists()
    data, rate = sf.read(str(wav), dtype="int16")
    assert rate == 16000
    # 2 frames x 320 samples each = 640 samples.
    assert data.shape[0] == 2 * SAMPLES_PER_FRAME
