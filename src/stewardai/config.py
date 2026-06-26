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

    # LLM (Gemini via LiteLLM)
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"
    llm_model: str | None = None  # explicit override; else derived from gemini_model

    # Bridge
    bridge_transport: Literal["tcp", "unix"] = "tcp"
    bridge_tcp_host: str = "127.0.0.1"
    bridge_tcp_port: int = 8765
    bridge_socket_path: str = "/tmp/stewardai.sock"

    # TTS
    tts_default_voice: str = "stub"

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
