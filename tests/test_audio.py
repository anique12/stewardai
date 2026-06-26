import numpy as np

from stewardai.common.audio import (
    BYTES_PER_FRAME,
    SAMPLES_PER_FRAME,
    AudioFrame,
    chunk_pcm,
    float_from_pcm,
    pcm_from_float,
    rms,
)


def test_frame_properties():
    f = AudioFrame(pcm=b"\x00\x00" * SAMPLES_PER_FRAME)
    assert f.num_samples == SAMPLES_PER_FRAME
    assert abs(f.duration_ms - 20.0) < 1e-6


def test_pcm_float_roundtrip():
    arr = (0.5 * np.sin(np.linspace(0, 10, SAMPLES_PER_FRAME))).astype(np.float32)
    back = float_from_pcm(pcm_from_float(arr))
    assert np.max(np.abs(back - arr)) < 1e-3


def test_chunk_pcm_full_and_remainder():
    pcm = b"\x01\x01" * (SAMPLES_PER_FRAME * 3) + b"\x02" * 100
    chunks = list(chunk_pcm(pcm))
    assert len(chunks) == 4
    assert all(len(c) == BYTES_PER_FRAME for c in chunks[:3])
    assert len(chunks[3]) == 100


def test_rms_silence_is_zero():
    assert rms(b"\x00\x00" * SAMPLES_PER_FRAME) == 0.0
    assert rms(b"") == 0.0
