"""Deterministic LLM stub — echoes the last user message. No network."""

from __future__ import annotations

from collections.abc import AsyncIterator

from stewardai.common.audio import Message


class StubLLM:
    name = "stub"

    def __init__(self, settings: object | None = None) -> None:
        pass

    async def complete(
        self, messages: list[Message], *, system: str | None = None, temperature: float = 0.4
    ) -> AsyncIterator[str]:
        last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        reply = f"You said: {last_user}. This is a stubbed reply."
        for word in reply.split():
            yield word + " "

    async def aclose(self) -> None:
        return None
