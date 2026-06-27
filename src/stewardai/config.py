"""Application settings, loaded from environment / .env.

The whole app is configured here. CPU<->GPU is a single `device` switch; backends
are selected by name so a `stub` (no heavy deps) and a real backend are swappable.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Compute
    device: Literal["cpu", "cuda"] = "cpu"

    # Backend selection
    stt_backend: str = "stub"
    tts_backend: str = "stub"
    llm_backend: str = "litellm"
    turn_detector: str = "silence"

    # Turn endpointing — LiveKit AgentSession config, NOT custom turn logic.
    # min_delay must exceed STT latency so the linguistic/backchannel EOU check can
    # run before the audio turn detector flushes the turn; otherwise turns fire on
    # pauses/backchannels. CPU Parakeet is ~1.5-2.2s, so keep these high; on GPU
    # (STT ~150ms) drop them (e.g. 0.4 / 2.0) for snappier turns.
    turn_min_delay: float = 2.0
    turn_max_delay: float = 4.0

    # Far-field / noisy-room tuning. English-only STT hallucinates words ("yeah",
    # "thank you") on distant non-English background speech; gate it at the source.
    # Raise vad_activation_threshold so only louder/closer speech counts as speech
    # (0.5 = LiveKit default). vad_min_speech_duration ignores brief blips. A higher
    # interruption_min_words stops a 1-word hallucination from cutting off the agent.
    # NOTE: these reduce — not eliminate — false triggers; loud background still gets
    # through. The real fixes are a close mic / push-to-talk / wake word.
    vad_activation_threshold: float = 0.6
    vad_min_speech_duration: float = 0.2
    interruption_min_words: int = 2
    # LiveKit default True: after a barge-in it pauses, waits, and if it judges the
    # interruption "false" it RESUMES the same reply. We default False so a barge-in
    # definitively stops the agent. (Set True for prod if you want backchannels like
    # "mm-hmm" to not cut the agent off.)
    resume_false_interruption: bool = False
    # Barge-in responsiveness. "vad" = cut off on voice activity (fast, simple);
    # "adaptive" = ML backchannel-vs-interruption (smarter, but ~1-2s slower to fire
    # and suppresses speech early in the agent's turn). min_duration = seconds of
    # speech before a barge-in registers.
    interruption_mode: str = "vad"
    interruption_min_duration: float = 0.25

    # LLM (Gemini via LiteLLM)
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"
    llm_model: str | None = None  # explicit override; else derived from gemini_model
    # Backstop so a stalled LLM stream can't silently hang a turn forever (the agent
    # would produce no reply and no error). Surfaces as an error instead.
    llm_timeout_s: float = 20.0

    # Bridge
    bridge_transport: Literal["tcp", "unix"] = "tcp"
    bridge_tcp_host: str = "127.0.0.1"
    bridge_tcp_port: int = 8765
    bridge_socket_path: str = "/tmp/stewardai.sock"

    # TTS
    tts_default_voice: str = "stub"

    # Whisper STT (faster-whisper / CTranslate2). Batch model, fast on CPU (int8).
    whisper_model: str = "large-v3-turbo"
    whisper_compute_type: str | None = None  # None -> int8 (cpu) / float16 (cuda)
    whisper_beam_size: int = 1  # greedy-ish; fastest on CPU
    whisper_language: str = "en"

    # Piper TTS (local neural). Voice models (.onnx + .json) download here on first use.
    piper_data_dir: str = "~/.cache/stewardai/piper"

    # Logging
    log_level: str = "info"
    log_format: Literal["json", "console"] = "json"

    @property
    def resolved_llm_model(self) -> str:
        """LiteLLM model string. Gemini models get a `gemini/` prefix if absent."""
        if self.llm_model:
            return self.llm_model
        m = self.gemini_model.strip()
        return m if "/" in m else f"gemini/{m}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
