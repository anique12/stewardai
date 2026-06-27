"""Real TTS backend: Kokoro-82M.

Kokoro synthesizes 24 kHz float mono audio per text segment. We resample each
segment to the canonical 16 kHz, convert to s16le, and stream it as 20 ms
``AudioFrame``s. Synthesis runs in a worker thread; frames for the first segment
are yielded as soon as it is ready, so first-audio latency tracks one segment,
not the whole utterance.

``kokoro``/``torch`` are imported lazily so this module imports cleanly without
the heavy ML extra installed.
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

# Kokoro's native output rate.
_KOKORO_RATE = 24_000

# Map our default lang to Kokoro's lang_code. 'a' = American English.
_LANG_CODE = "a"

# Curated English voices shipped with Kokoro-82M. Verified against the published
# Kokoro VOICES list (af_*/am_* = American female/male, bf_*/bm_* = British).
_DEFAULT_VOICES = ["af_heart", "af_bella", "am_michael", "bf_emma"]

# Kokoro uses "stub" nowhere; if the configured default is the stub sentinel,
# fall back to a sensible Kokoro voice.
_FALLBACK_VOICE = "af_heart"

_log = get_logger("tts.kokoro")


class KokoroTTS:
    name = "kokoro"

    def __init__(self, settings: object | None = None) -> None:
        self._settings = settings
        self._device = getattr(settings, "device", "cpu") or "cpu"
        configured = getattr(settings, "tts_default_voice", None)
        if not configured or configured == "stub":
            configured = _FALLBACK_VOICE
        self._default_voice = configured
        self._pipeline = None  # lazily built KPipeline

    @property
    def voices(self) -> list[str]:
        return list(_DEFAULT_VOICES)

    def _ensure_pipeline(self):
        """Build the Kokoro pipeline on first use (heavy import lives here)."""
        if self._pipeline is None:
            from kokoro import KPipeline  # lazy heavy import

            _log.info("kokoro_load", device=self._device, lang_code=_LANG_CODE)
            self._pipeline = KPipeline(lang_code=_LANG_CODE, device=self._device)
        return self._pipeline

    @staticmethod
    def _segment_to_float(audio) -> np.ndarray:
        """Coerce one Kokoro segment's audio into a 1-D float32 numpy array."""
        # Newer kokoro yields a Result object (.audio is a torch tensor);
        # older versions yield (graphemes, phonemes, audio) tuples.
        if hasattr(audio, "detach"):  # torch.Tensor
            audio = audio.detach().cpu().numpy()
        arr = np.asarray(audio, dtype=np.float32)
        return arr.reshape(-1)

    def _segment_pcm(self, result) -> bytes | None:
        """Convert one Kokoro segment result to s16le @16 kHz, or None to skip."""
        audio = getattr(result, "audio", None)
        if audio is None and isinstance(result, tuple):
            audio = result[-1]  # (graphemes, phonemes, audio)
        if audio is None:
            return None
        arr = self._segment_to_float(audio)
        if arr.size == 0:
            return None
        return pcm_from_float(resample_linear(arr, _KOKORO_RATE, SAMPLE_RATE))

    async def synthesize(
        self, text: str, *, voice: str | None = None
    ) -> AsyncIterator[AudioFrame]:
        chosen = voice or self._default_voice
        # "stub" is the stub-backend sentinel (e.g. the global tts_default_voice
        # default); it is not a real Kokoro voice, so fall back to our default.
        if chosen == "stub":
            chosen = self._default_voice
        if not text or not text.strip():
            return
        # Stream per segment: run Kokoro's (blocking) generator in a worker thread
        # and hand each segment's PCM to the event loop AS SOON AS it's produced,
        # so first-audio latency tracks the FIRST segment, not the whole utterance.
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        _DONE = object()

        def _produce() -> None:
            try:
                pipeline = self._ensure_pipeline()
                for result in pipeline(text, voice=chosen):
                    pcm = self._segment_pcm(result)
                    if pcm:
                        loop.call_soon_threadsafe(queue.put_nowait, pcm)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, _DONE)

        loop.run_in_executor(None, _produce)
        while True:
            pcm = await queue.get()
            if pcm is _DONE:
                break
            for frame in chunk_pcm(pcm):
                if frame:
                    yield AudioFrame(pcm=frame, sample_rate=SAMPLE_RATE)

    async def aclose(self) -> None:
        self._pipeline = None
