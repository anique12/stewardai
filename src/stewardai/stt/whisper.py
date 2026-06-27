"""Real STT backend: Whisper large-v3-turbo via faster-whisper (CTranslate2).

Like Parakeet this is a BATCH model — we decode the finalized utterance buffer
(turn detection / endpointing happens upstream). CTranslate2 is fast on CPU with
``int8`` (``float16`` on CUDA). English-only by default.

Anti-hallucination settings matter here: Whisper is notorious for emitting
"thank you"/"yeah" on noise or background speech, so we decode greedily
(``temperature=0``), disable ``condition_on_previous_text`` (no looping on prior
text), and enable ``vad_filter`` so non-speech regions are dropped before
decoding (a background-only utterance then yields empty text -> no turn).

``faster_whisper`` is imported lazily so this module imports without the dep.
"""

from __future__ import annotations

import asyncio
import os

import numpy as np

from stewardai.common.audio import SAMPLE_RATE, Transcript, float_from_pcm, resample_linear
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("stt.whisper")


class WhisperSTT:
    name = "faster_whisper"

    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()
        device = self._s.device  # "cpu" | "cuda"
        compute_type = self._s.whisper_compute_type or (
            "float16" if device == "cuda" else "int8"
        )
        self._lang = self._s.whisper_language or "en"
        self._beam_size = self._s.whisper_beam_size
        model_name = self._s.whisper_model

        # The HF xet transfer has stalled on this box before; force plain transfer.
        os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

        from faster_whisper import WhisperModel  # noqa: PLC0415 - lazy heavy import

        _log.info("loading_model", model=model_name, device=device, compute_type=compute_type)
        self._model = WhisperModel(model_name, device=device, compute_type=compute_type)
        _log.info("model_loaded", model=model_name)

    async def transcribe(
        self, pcm: bytes, *, sample_rate: int = SAMPLE_RATE, lang: str = "en"
    ) -> Transcript:
        """Batch-decode a finalized utterance buffer."""
        audio = float_from_pcm(pcm)
        duration_ms = 1000.0 * audio.size / sample_rate
        if audio.size == 0:
            return Transcript(text="", is_final=True, confidence=None, t_start_ms=0.0, t_end_ms=0.0)
        if sample_rate != SAMPLE_RATE:
            audio = resample_linear(audio, sample_rate, SAMPLE_RATE)
        text = await asyncio.to_thread(self._transcribe_sync, audio)
        return Transcript(
            text=text, is_final=True, confidence=None, t_start_ms=0.0, t_end_ms=duration_ms
        )

    def _transcribe_sync(self, audio) -> str:
        """Blocking inference; run via asyncio.to_thread. faster-whisper accepts a
        float32 numpy array @16 kHz directly (no temp file).
        """
        samples = np.ascontiguousarray(audio, dtype=np.float32)
        segments, _info = self._model.transcribe(
            samples,
            language=self._lang,
            beam_size=self._beam_size,
            temperature=0.0,  # greedy: fewer hallucinations than the temperature fallback
            condition_on_previous_text=False,  # don't loop on prior text
            vad_filter=True,  # drop non-speech regions (background) before decoding
        )
        return "".join(seg.text for seg in segments).strip()

    async def aclose(self) -> None:
        self._model = None
