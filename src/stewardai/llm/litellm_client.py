"""Real LLM backend via LiteLLM. Model selected by string (Gemini by default).

Switching model/provider = change LLM_MODEL (or GEMINI_MODEL) in env; no code change.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

from stewardai.common.audio import Message
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("llm.litellm")


class LiteLLMClient:
    name = "litellm"

    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()
        if self._s.gemini_api_key:
            os.environ.setdefault("GEMINI_API_KEY", self._s.gemini_api_key)
        self.model = self._s.resolved_llm_model

    async def complete(
        self, messages: list[Message], *, system: str | None = None, temperature: float = 0.4
    ) -> AsyncIterator[str]:
        import litellm  # lazy: base dep, but keep import local for fast module load

        payload = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)

        response = await litellm.acompletion(
            model=self.model,
            messages=payload,
            stream=True,
            temperature=temperature,
            timeout=self._s.llm_timeout_s,  # backstop against a silently hung stream
        )
        async for chunk in response:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    async def aclose(self) -> None:
        return None
