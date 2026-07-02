"""Deterministic LLM stub — echoes the last user message. No network."""

from __future__ import annotations

from collections.abc import AsyncIterator

from stewardai.common.audio import Decision, Message


class StubLLM:
    name = "stub"

    def __init__(self, settings: object | None = None) -> None:
        self.next_decision: Decision | None = None  # set by tests; None -> stay silent

    async def complete(
        self, messages: list[Message], *, system: str | None = None, temperature: float = 0.4
    ) -> AsyncIterator[str]:
        last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        reply = f"You said: {last_user}. This is a stubbed reply."
        for word in reply.split():
            yield word + " "

    async def decide(  # noqa: ANN001
        self, messages: list[Message], *, system: str | None = None, action_tools=None
    ) -> Decision:
        return self.next_decision or Decision(speak=False)

    async def phrase_result(  # noqa: ANN001
        self, messages: list[Message], *, system=None, slug=None, result=None
    ) -> str:
        return f"Done: {slug}."

    async def decide_stream(self, messages, *, system=None, action_tools=None):  # noqa: ANN001
        """Translate next_decision into the streaming event protocol used by
        tool_turn.resolve_turn: ('text', delta) / ('action', slug, args) / nothing."""
        d = self.next_decision or Decision(speak=False)
        if not d.speak:
            return
        if d.action_slug:
            yield ("action", d.action_slug, d.action_args or {})
            return
        if d.text:
            yield ("text", d.text)

    async def phrase_result_stream(self, messages, *, system=None, slug=None, result=None):  # noqa: ANN001
        yield f"Done: {slug}."

    async def aclose(self) -> None:
        return None
