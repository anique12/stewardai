"""Tiny, self-generating sample dataset for the STT eval wiring check.

Real labeled meeting audio is not available offline, so each clip is synthesized
from :class:`stewardai.tts.stub.StubTTS` (a quiet sine tone, 16 kHz mono s16le) and
its reference text is set to the *deterministic* output of
:class:`stewardai.stt.stub.StubSTT`. Feeding such a clip through the stub STT
therefore yields WER == 0 — a pure wiring check, not a quality measurement.

The clips are generated on first use (idempotent) so the repo carries no binary
blobs and ``*.wav`` can stay git-ignored. See ``README.md`` for how to drop in a
real labeled set.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

from stewardai.common.audio import SAMPLE_RATE, float_from_pcm
from stewardai.stt.stub import _DEFAULT_UTTERANCE
from stewardai.tts.stub import StubTTS

DATASET_DIR = Path(__file__).resolve().parent
REFS_FILE = DATASET_DIR / "refs.json"
N_CLIPS = 4

# Every stub clip transcribes to the StubSTT default, so reference == hypothesis.
_REFERENCE = _DEFAULT_UTTERANCE

# Distinct voices/lengths so the clips are not byte-identical, while all still
# transcribing (via the stub) to the same deterministic reference.
_CLIP_SPECS: list[tuple[str, str]] = [
    ("stub", "Hello there."),
    ("stub-low", "Can you hear me clearly on this call?"),
    ("stub-high", "Let us begin the meeting now."),
    ("stub", "Thanks everyone for joining today."),
]


async def _synthesize_pcm(text: str, voice: str) -> bytes:
    """Render `text` through StubTTS into one contiguous s16le buffer."""
    tts = StubTTS()
    chunks: list[bytes] = []
    async for frame in tts.synthesize(text, voice=voice):
        chunks.append(frame.pcm)
    await tts.aclose()
    return b"".join(chunks)


async def ensure_dataset(dataset_dir: str | Path | None = None) -> Path:
    """Generate the sample clips + refs.json if missing. Returns the dataset dir.

    Idempotent: existing, complete datasets are left untouched.
    """
    out = Path(dataset_dir) if dataset_dir is not None else DATASET_DIR
    out.mkdir(parents=True, exist_ok=True)
    refs_path = out / "refs.json"

    expected = [f"clip_{i:02d}.wav" for i in range(1, N_CLIPS + 1)]
    have_all = refs_path.exists() and all((out / name).exists() for name in expected)
    if have_all:
        return out

    refs: dict[str, str] = {}
    for i, (voice, text) in enumerate(_CLIP_SPECS[:N_CLIPS], start=1):
        name = f"clip_{i:02d}.wav"
        pcm = await _synthesize_pcm(text, voice)
        samples = float_from_pcm(pcm)
        sf.write(out / name, samples, SAMPLE_RATE, subtype="PCM_16")
        refs[name] = _REFERENCE

    refs_path.write_text(json.dumps(refs, indent=2, sort_keys=True) + "\n")
    return out


def load_refs(dataset_dir: str | Path | None = None) -> dict[str, str]:
    """Load the clip -> reference-text mapping (raises if absent)."""
    out = Path(dataset_dir) if dataset_dir is not None else DATASET_DIR
    return json.loads((out / "refs.json").read_text())


def read_clip(path: str | Path) -> bytes:
    """Read a 16 kHz mono WAV as s16le PCM bytes (resampling/mixing if needed)."""
    data, sr = sf.read(str(path), dtype="int16", always_2d=False)
    if data.ndim > 1:  # downmix to mono
        data = data.mean(axis=1).astype(np.int16)
    pcm = data.astype("<i2").tobytes()
    if sr != SAMPLE_RATE:
        from stewardai.common.audio import pcm_from_float, resample_linear

        pcm = pcm_from_float(resample_linear(float_from_pcm(pcm), sr, SAMPLE_RATE))
    return pcm
