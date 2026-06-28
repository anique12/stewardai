"""Real STT backend: NVIDIA Parakeet TDT 0.6B v3 via NeMo.

Parakeet TDT 0.6B is an OFFLINE model: we batch-decode the whole finalized
utterance buffer (turn detection / endpointing happens upstream). The heavy
import (`nemo`, which pulls in torch) is kept lazy inside `__init__` so this
module imports fine on a machine without NeMo installed.
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from stewardai.common.audio import SAMPLE_RATE, Transcript, float_from_pcm
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("stt.parakeet")


class ParakeetNeMoSTT:
    name = "parakeet_nemo"

    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()
        self._device = self._s.device  # "cpu" | "cuda"
        # v3 (multilingual) by default; switch to v2 (English-only) purely by env.
        model_name = self._s.parakeet_model

        # Lazy heavy import: importing this module must not require NeMo/torch.
        from nemo.collections.asr.models import ASRModel  # noqa: PLC0415

        _log.info("loading_model", model=model_name, device=self._device)
        model = ASRModel.from_pretrained(model_name=model_name)
        model = model.to(self._device)
        model.eval()
        self._model = model
        _log.info("model_loaded", model=model_name, device=self._device)

    async def transcribe(
        self, pcm: bytes, *, sample_rate: int = SAMPLE_RATE, lang: str = "en"
    ) -> Transcript:
        """Batch-decode a finalized utterance buffer (offline)."""
        audio = float_from_pcm(pcm)
        duration_ms = 1000.0 * audio.size / sample_rate
        if audio.size == 0:
            return Transcript(text="", is_final=True, confidence=None, t_start_ms=0.0, t_end_ms=0.0)

        text = await asyncio.to_thread(self._transcribe_sync, audio, sample_rate)
        return Transcript(
            text=text,
            is_final=True,
            confidence=None,
            t_start_ms=0.0,
            t_end_ms=duration_ms,
        )

    def _transcribe_sync(self, audio, sample_rate: int) -> str:
        """Blocking inference; run via asyncio.to_thread. Writes a temp 16 kHz wav
        and hands the path to NeMo's offline transcribe API.
        """
        import soundfile as sf  # noqa: PLC0415

        with tempfile.TemporaryDirectory() as tmp:
            wav_path = str(Path(tmp) / "utterance.wav")
            sf.write(wav_path, audio, sample_rate, subtype="PCM_16")
            results = self._model.transcribe([wav_path], batch_size=1)
        return _first_text(results)

    async def aclose(self) -> None:
        model = getattr(self, "_model", None)
        self._model = None
        if model is None:
            return
        del model
        # Best-effort: release CUDA memory if torch is loaded and we used the GPU.
        if self._device == "cuda":
            try:
                import torch  # noqa: PLC0415

                torch.cuda.empty_cache()
            except Exception:  # pragma: no cover - cleanup is best-effort
                pass


def _first_text(results) -> str:
    """Normalize NeMo's transcribe() output to a single string.

    `ASRModel.transcribe` returns a list; depending on NeMo version each element
    is either a plain `str` or a `Hypothesis`-like object exposing `.text`.
    """
    if not results:
        return ""
    item = results[0]
    if isinstance(item, str):
        return item
    text = getattr(item, "text", None)
    if isinstance(text, str):
        return text
    return str(item)
