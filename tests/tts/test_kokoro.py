import pytest

from stewardai.common.audio import BYTES_PER_FRAME, SAMPLE_RATE
from stewardai.tts.kokoro import KokoroTTS

pytestmark = pytest.mark.heavy

pytest.importorskip("kokoro")


def test_voices_non_empty():
    assert KokoroTTS().voices


async def test_synthesize_yields_16k_frames():
    tts = KokoroTTS()
    try:
        frames = [f async for f in tts.synthesize("hello world", voice="af_heart")]
    finally:
        await tts.aclose()

    assert len(frames) >= 1
    # Canonical 20 ms frame at 16 kHz is 640 bytes; at least one full frame.
    assert any(len(f.pcm) == BYTES_PER_FRAME for f in frames)
    assert all(len(f.pcm) <= BYTES_PER_FRAME for f in frames)
    assert all(f.sample_rate == SAMPLE_RATE for f in frames)
