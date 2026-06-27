"""Real TTS backend: Piper (local VITS neural TTS).

Piper synthesizes int16 PCM at the voice's native rate (22.05 kHz for *medium*
voices). We take each chunk's float audio, resample to the canonical 16 kHz, and
stream 20 ms ``AudioFrame``s — first chunk yielded as soon as it's ready, so
first-audio latency tracks one chunk, not the whole utterance.

Voice models (``<name>.onnx`` + ``.onnx.json``) download once to
``settings.piper_data_dir``. Runs fully locally at synth time (no network). Needs
system ``espeak-ng`` (already required by Kokoro).

``piper`` is imported lazily so this module imports without the dep.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

from stewardai.common.audio import (
    SAMPLE_RATE,
    AudioFrame,
    chunk_pcm,
    pcm_from_float,
    resample_linear,
)
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("tts.piper")

# A solid, natural English voice; medium quality = good latency/quality balance.
_DEFAULT_VOICE = "en_US-lessac-medium"


class PiperTTS:
    name = "piper"

    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()
        configured = getattr(settings, "tts_default_voice", None)
        if not configured or configured == "stub":
            configured = _DEFAULT_VOICE
        self._default_voice = configured
        self._cache_dir = Path(self._s.piper_data_dir).expanduser()
        self._voices: dict[str, object] = {}  # name -> loaded PiperVoice (lazy)

    @property
    def voices(self) -> list[str]:
        return [self._default_voice]

    def _ensure_voice(self, name: str):
        """Download (once) + load a Piper voice. Heavy import lives here."""
        if name in self._voices:
            return self._voices[name]
        from piper import PiperVoice  # noqa: PLC0415 - lazy
        from piper.download_voices import download_voice  # noqa: PLC0415

        self._cache_dir.mkdir(parents=True, exist_ok=True)
        onnx = self._cache_dir / f"{name}.onnx"
        if not onnx.exists():
            _log.info("piper_download", voice=name, dir=str(self._cache_dir))
            download_voice(name, self._cache_dir)
        _log.info("piper_load", voice=name)
        voice = PiperVoice.load(str(onnx))
        self._voices[name] = voice
        return voice

    async def synthesize(
        self, text: str, *, voice: str | None = None
    ) -> AsyncIterator[AudioFrame]:
        chosen = voice or self._default_voice
        if chosen == "stub":  # stub-backend sentinel is not a real Piper voice
            chosen = self._default_voice
        if not text or not text.strip():
            return

        # Piper's synth is blocking; run it in a worker thread and hand each chunk's
        # PCM to the event loop as soon as it's produced (stream per chunk).
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        _DONE = object()

        def _produce() -> None:
            try:
                voice_obj = self._ensure_voice(chosen)
                for chunk in voice_obj.synthesize(text):
                    pcm = self._chunk_pcm(chunk)
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

    @staticmethod
    def _chunk_pcm(chunk) -> bytes | None:
        """Resample one Piper AudioChunk's float audio to s16le @16 kHz."""
        arr = getattr(chunk, "audio_float_array", None)
        rate = getattr(chunk, "sample_rate", SAMPLE_RATE) or SAMPLE_RATE
        if arr is None or arr.size == 0:
            return None
        return pcm_from_float(resample_linear(arr, rate, SAMPLE_RATE))

    async def aclose(self) -> None:
        self._voices.clear()
