"""TTS eval: time-to-first-audio (TTFA) and real-time factor (RTF).

For each sample sentence, drives ``make_tts().synthesize`` and measures:
  * TTFA  — wall-clock from the synth call to the first emitted frame (ms).
  * RTF   — total synthesis wall-time / produced audio duration (lower is better;
            < 1.0 means faster-than-real-time).
"""

from __future__ import annotations

import time

from stewardai.config import Settings
from stewardai.factory import make_tts

from .stt_eval import _percentile

SAMPLE_SENTENCES: list[str] = [
    "Hello, how can I help you today?",
    "Let me summarize the last few points from the meeting.",
    "I think we should follow up on that action item.",
    "Sure, I can do that right away.",
]


def _eval_settings(settings: Settings | None) -> Settings:
    if settings is not None:
        return settings
    return Settings(_env_file=None, stt_backend="stub", tts_backend="stub", llm_backend="stub")


async def run_tts_eval(
    sentences: list[str] | None = None,
    settings: Settings | None = None,
) -> dict:
    """Synthesize each sentence; return ``{"sentences", "p50_ttfa_ms", "rtf"}``.

    Also includes ``per_sentence`` detail for debugging.
    """
    sentences = sentences if sentences is not None else SAMPLE_SENTENCES
    tts = make_tts(_eval_settings(settings))

    ttfas: list[float] = []
    per_sentence: list[dict] = []
    total_synth_s = 0.0
    total_audio_s = 0.0
    try:
        for text in sentences:
            t0 = time.perf_counter()
            ttfa_ms: float | None = None
            audio_ms = 0.0
            frames = 0
            async for frame in tts.synthesize(text):
                if ttfa_ms is None:
                    ttfa_ms = (time.perf_counter() - t0) * 1000.0
                audio_ms += frame.duration_ms
                frames += 1
            synth_ms = (time.perf_counter() - t0) * 1000.0

            ttfa_ms = ttfa_ms if ttfa_ms is not None else synth_ms
            ttfas.append(ttfa_ms)
            total_synth_s += synth_ms / 1000.0
            total_audio_s += audio_ms / 1000.0
            sentence_rtf = (synth_ms / audio_ms) if audio_ms > 0 else 0.0
            per_sentence.append(
                {
                    "text": text,
                    "ttfa_ms": round(ttfa_ms, 2),
                    "frames": frames,
                    "audio_ms": round(audio_ms, 1),
                    "synth_ms": round(synth_ms, 2),
                    "rtf": round(sentence_rtf, 4),
                }
            )
    finally:
        await tts.aclose()

    rtf = (total_synth_s / total_audio_s) if total_audio_s > 0 else 0.0
    return {
        "sentences": len(per_sentence),
        "p50_ttfa_ms": round(_percentile(ttfas, 50), 2),
        "rtf": round(rtf, 4),
        "per_sentence": per_sentence,
    }
