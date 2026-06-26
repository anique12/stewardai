"""STT eval: Word Error Rate (jiwer) + per-clip transcription latency.

Runs the configured STT backend (stub by default) over every clip in a dataset
directory, comparing the hypothesis against the reference in ``refs.json``.

With the bundled stub dataset, hypothesis == reference, so WER == 0 — this is a
wiring check. Real WER needs a real STT backend and real labeled audio; see
``evals/datasets/README.md``.
"""

from __future__ import annotations

import time
from pathlib import Path

import jiwer

from stewardai.config import Settings
from stewardai.factory import make_stt

from .datasets import DATASET_DIR, ensure_dataset, load_refs, read_clip


def _percentile(values: list[float], pct: float) -> float:
    """Nearest-rank percentile of `values` (0..100). Empty -> 0.0."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(0, min(len(ordered) - 1, round(pct / 100.0 * (len(ordered) - 1))))
    return ordered[rank]


def _eval_settings(settings: Settings | None) -> Settings:
    """Force the stub STT backend unless the caller supplied explicit settings."""
    if settings is not None:
        return settings
    return Settings(_env_file=None, stt_backend="stub", tts_backend="stub", llm_backend="stub")


async def run_stt_eval(
    dataset_dir: str | Path | None = None,
    settings: Settings | None = None,
) -> dict:
    """Transcribe every clip, score WER, and time each transcribe() call.

    Returns ``{"n", "wer", "p50_latency_ms", "per_clip": [...]}`` where each
    per-clip entry has ``clip``, ``reference``, ``hypothesis``, ``wer`` and
    ``latency_ms``.
    """
    dataset_dir = Path(dataset_dir) if dataset_dir is not None else DATASET_DIR
    await ensure_dataset(dataset_dir)
    refs = load_refs(dataset_dir)

    stt = make_stt(_eval_settings(settings))
    per_clip: list[dict] = []
    references: list[str] = []
    hypotheses: list[str] = []
    latencies: list[float] = []
    try:
        for clip_name in sorted(refs):
            reference = refs[clip_name]
            pcm = read_clip(dataset_dir / clip_name)

            t0 = time.perf_counter()
            transcript = await stt.transcribe(pcm)
            latency_ms = (time.perf_counter() - t0) * 1000.0

            hypothesis = transcript.text
            clip_wer = jiwer.wer(reference, hypothesis)
            references.append(reference)
            hypotheses.append(hypothesis)
            latencies.append(latency_ms)
            per_clip.append(
                {
                    "clip": clip_name,
                    "reference": reference,
                    "hypothesis": hypothesis,
                    "wer": round(clip_wer, 4),
                    "latency_ms": round(latency_ms, 2),
                }
            )
    finally:
        await stt.aclose()

    corpus_wer = jiwer.wer(references, hypotheses) if references else 0.0
    return {
        "n": len(per_clip),
        "wer": round(corpus_wer, 4),
        "p50_latency_ms": round(_percentile(latencies, 50), 2),
        "per_clip": per_clip,
    }
