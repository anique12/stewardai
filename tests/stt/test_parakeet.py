"""Heavy test for the real Parakeet/NeMo STT backend.

Skipped unless NeMo is installed (it pulls in torch and downloads a ~0.6B model).
Run on the box with: `pytest -m heavy tests/stt/test_parakeet.py`.
"""

from __future__ import annotations

import numpy as np
import pytest

from stewardai.common.audio import SAMPLE_RATE, pcm_from_float
from stewardai.config import Settings

pytestmark = pytest.mark.heavy

nemo = pytest.importorskip("nemo")  # noqa: F841  skip the whole module if NeMo absent


def _tone_pcm(seconds: float = 1.0, freq: float = 220.0, amp: float = 0.2) -> bytes:
    """A synthetic 16 kHz mono s16le buffer (deterministic, no network/fixtures)."""
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return pcm_from_float((amp * np.sin(2 * np.pi * freq * t)).astype(np.float32))


async def test_transcribe_returns_string_and_honors_device():
    from stewardai.stt.parakeet_nemo import ParakeetNeMoSTT

    stt = ParakeetNeMoSTT(Settings(device="cpu"))
    try:
        # Model is placed on the configured device.
        model = stt._model
        params = list(model.parameters())
        assert params, "model exposed no parameters to check device placement"
        assert all(p.device.type == "cpu" for p in params)

        transcript = await stt.transcribe(_tone_pcm(), sample_rate=SAMPLE_RATE)

        # A finalized, batch-decoded transcript; text is a (possibly empty) string,
        # and timing spans the utterance duration.
        assert transcript.is_final is True
        assert isinstance(transcript.text, str)
        assert transcript.t_start_ms == 0.0
        assert transcript.t_end_ms == pytest.approx(1000.0, rel=0.05)
    finally:
        await stt.aclose()


async def test_empty_buffer_is_safe():
    from stewardai.stt.parakeet_nemo import ParakeetNeMoSTT

    stt = ParakeetNeMoSTT(Settings(device="cpu"))
    try:
        transcript = await stt.transcribe(b"")
        assert transcript.is_final is True
        assert transcript.text == ""
        assert transcript.t_end_ms == 0.0
    finally:
        await stt.aclose()
