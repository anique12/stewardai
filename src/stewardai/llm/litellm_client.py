"""Real LLM backend via LiteLLM. Model selected by string (Gemini by default).

Switching model/provider = change LLM_MODEL (or GEMINI_MODEL) in env; no code change.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

from stewardai.common.audio import Decision, Message
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("llm.litellm")

_DECIDE_TOOLS = [
    {"type": "function", "function": {
        "name": "speak",
        "description": "Say this reply aloud into the meeting. Use only when addressed "
                       "(e.g. the wake word) or when a response is clearly useful.",
        "parameters": {"type": "object",
                       "properties": {"text": {"type": "string"}},
                       "required": ["text"]}}},
    {"type": "function", "function": {
        "name": "stay_silent",
        "description": "Do not respond. Use this by default when not addressed.",
        "parameters": {"type": "object", "properties": {}}}},
]


def _parse_decision(tool_calls) -> Decision:  # noqa: ANN001
    """Map an LLM tool_calls list to a Decision (defaults to silent)."""
    if not tool_calls:
        return Decision(speak=False)
    call = tool_calls[0]
    name = call.function.name
    if name == "speak":
        try:
            text = (json.loads(call.function.arguments or "{}") or {}).get("text", "")
        except (ValueError, TypeError):
            text = ""
        return Decision(speak=bool(text), text=text)
    return Decision(speak=False)


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

    async def decide(self, messages, *, system=None):  # noqa: ANN001
        import litellm  # lazy

        payload = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        resp = await litellm.acompletion(
            model=self.model, messages=payload, tools=_DECIDE_TOOLS,
            tool_choice="required", temperature=0.0, timeout=self._s.llm_timeout_s,
        )
        msg = resp.choices[0].message
        decision = _parse_decision(getattr(msg, "tool_calls", None))
        _log.info("llm_decide", backend=self.name, speak=decision.speak)
        return decision

    async def aclose(self) -> None:
        return None
