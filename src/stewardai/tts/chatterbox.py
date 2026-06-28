"""Real TTS backend: Chatterbox (Resemble AI).

Chatterbox is a ~0.5B open (MIT) TTS model with state-of-the-art naturalness,
emotion control and optional zero-shot voice cloning. We use the multilingual
variant (23 languages) by default to match our multilingual STT; set
``CHATTERBOX_MULTILINGUAL=false`` for the English-only model.

Like our other TTS backends we synthesize per call, resample the model's native
rate to the canonical 16 kHz, convert to s16le, and stream 20 ms ``AudioFrame``s.
Generation runs in a worker thread so the event loop is never blocked. (LiveKit
feeds us sentence-sized chunks, so one ``generate`` per call already streams at
sentence granularity in the live pipeline.)

NOTE: Chatterbox embeds an imperceptible Perth watermark in all output.

``chatterbox``/``torch`` are imported lazily so this module imports cleanly
without the ``chatterbox`` extra installed.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import numpy as np

from stewardai.common.audio import (
    SAMPLE_RATE,
    AudioFrame,
    chunk_pcm,
    pcm_from_float,
    resample_linear,
)
from stewardai.common.logging import get_logger

_log = get_logger("tts.chatterbox")

# Chatterbox's native output rate (S3Gen); we read model.sr at load and fall
# back to this if it's missing.
_DEFAULT_RATE = 24_000


class ChatterboxTTS:
    name = "chatterbox"

    def __init__(self, settings: object | None = None) -> None:
        self._device = getattr(settings, "device", "cpu") or "cpu"
        self._multilingual = bool(getattr(settings, "chatterbox_multilingual", True))
        self._language = getattr(settings, "chatterbox_language", "en") or "en"
        # Optional path to a short reference wav for zero-shot voice cloning;
        # None -> Chatterbox's built-in default voice.
        self._voice_sample = getattr(settings, "chatterbox_voice_sample", None) or None
        self._model = None  # lazily loaded on first synthesize
        self._sr = _DEFAULT_RATE  # model native rate, refined on load

    @property
    def voices(self) -> list[str]:
        # Chatterbox ships one built-in voice; cloning is via a reference wav
        # (CHATTERBOX_VOICE_SAMPLE), not a named voice.
        return ["default"]

    def _ensure_model(self):
        """Load the Chatterbox model on first use (heavy import lives here)."""
        if self._model is None:
            # Aliased imports: the library's own class is also ``ChatterboxTTS``.
            if self._multilingual:
                from chatterbox.mtl_tts import ChatterboxMultilingualTTS as _Model  # noqa: PLC0415
            else:
                from chatterbox.tts import ChatterboxTTS as _Model  # noqa: PLC0415

            _log.info("chatterbox_load", device=self._device, multilingual=self._multilingual)
            self._model = _Model.from_pretrained(device=self._device)
            self._sr = int(getattr(self._model, "sr", _DEFAULT_RATE) or _DEFAULT_RATE)
            _log.info("chatterbox_loaded", sample_rate=self._sr)
        return self._model

    @staticmethod
    def _to_float(wav) -> np.ndarray:
        """Coerce Chatterbox output (torch tensor, shape (1, n) or (n,)) to 1-D float32."""
        if hasattr(wav, "detach"):  # torch.Tensor
            wav = wav.detach().cpu().numpy()
        return np.asarray(wav, dtype=np.float32).reshape(-1)

    def _generate_pcm(self, text: str) -> bytes | None:
        """Blocking synthesis; run via asyncio.to_thread. Returns s16le @16 kHz."""
        model = self._ensure_model()
        kwargs: dict = {}
        if self._voice_sample:
            kwargs["audio_prompt_path"] = self._voice_sample
        if self._multilingual:
            # The multilingual model has no auto-detect; it needs a language_id.
            kwargs["language_id"] = self._language
        wav = model.generate(text, **kwargs)
        arr = self._to_float(wav)
        if arr.size == 0:
            return None
        return pcm_from_float(resample_linear(arr, self._sr, SAMPLE_RATE))

    async def synthesize(
        self, text: str, *, voice: str | None = None
    ) -> AsyncIterator[AudioFrame]:
        # `voice` is accepted for the TTSBackend contract but unused: Chatterbox's
        # voice is its built-in default or a cloning sample (CHATTERBOX_VOICE_SAMPLE).
        if not text or not text.strip():
            return
        pcm = await asyncio.to_thread(self._generate_pcm, text)
        if not pcm:
            return
        for frame in chunk_pcm(pcm):
            if frame:
                yield AudioFrame(pcm=frame, sample_rate=SAMPLE_RATE)

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
