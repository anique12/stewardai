"""Env-driven backend selection with lazy imports.

Heavy backends are imported only when selected, so the base install (stubs +
LiteLLM) never needs torch/nemo/kokoro/livekit.
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

from stewardai.common.errors import BackendUnavailable
from stewardai.config import Settings, get_settings

if TYPE_CHECKING:
    from stewardai.interfaces import AudioBridge, LLMBackend, STTBackend, TTSBackend

_STT = {
    "stub": ("stewardai.stt.stub", "StubSTT"),
    "parakeet_nemo": ("stewardai.stt.parakeet_nemo", "ParakeetNeMoSTT"),
    "parakeet": ("stewardai.stt.parakeet_nemo", "ParakeetNeMoSTT"),  # alias
    "faster_whisper": ("stewardai.stt.whisper", "WhisperSTT"),
    "whisper": ("stewardai.stt.whisper", "WhisperSTT"),  # alias
}
_TTS = {
    "stub": ("stewardai.tts.stub", "StubTTS"),
    "kokoro": ("stewardai.tts.kokoro", "KokoroTTS"),
    "piper": ("stewardai.tts.piper", "PiperTTS"),
    "chatterbox": ("stewardai.tts.chatterbox", "ChatterboxTTS"),
}
_LLM = {
    "stub": ("stewardai.llm.stub", "StubLLM"),
    "litellm": ("stewardai.llm.litellm_client", "LiteLLMClient"),
}
_BRIDGE = {
    "socket": ("stewardai.bridge.audio_input", "SocketAudioBridge"),
}


def _load(kind: str, registry: dict[str, tuple[str, str]], name: str):
    try:
        module_name, class_name = registry[name]
    except KeyError as exc:
        raise BackendUnavailable(
            kind, name, f"Unknown backend. Options: {sorted(registry)}."
        ) from exc
    try:
        module = importlib.import_module(module_name)
    except ImportError as exc:
        raise BackendUnavailable(
            kind,
            name,
            f"Install its optional dependency (pip install '.[cpu]' or '.[cuda]'). ({exc})",
        ) from exc
    return getattr(module, class_name)


def make_stt(settings: Settings | None = None) -> STTBackend:
    s = settings or get_settings()
    return _load("STT", _STT, s.stt_backend)(s)


def make_tts(settings: Settings | None = None) -> TTSBackend:
    s = settings or get_settings()
    return _load("TTS", _TTS, s.tts_backend)(s)


def make_llm(settings: Settings | None = None) -> LLMBackend:
    s = settings or get_settings()
    return _load("LLM", _LLM, s.llm_backend)(s)


def make_bridge(settings: Settings | None = None) -> AudioBridge:
    s = settings or get_settings()
    return _load("Bridge", _BRIDGE, "socket")(s)
