"""Resolve one gated turn into the text chunk(s) to speak (or silence).

This is the live tool-calling brain, kept as a PURE async generator (no livekit) so
it is unit-testable. The gated LLM node iterates it and emits each yielded chunk as
a ChatChunk, so chunks are SPOKEN as they arrive. Each turn:

  1. ``decide_stream()`` — one streaming gate call: streams spoken text, or calls
     stay_silent (nothing), or calls a Composio action tool.
  2. plain speak → the streamed text is yielded as it arrives (TTS starts early).
  3. an ACTION → yield a short acknowledgment (unless the model already spoke a
     preamble), execute via ``executor``, then stream the phrased result.

``executor(slug, args) -> dict`` runs the actual Composio call (off the event loop)
and returns the raw result; the runner supplies it (it holds composio + user + tz).
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.tool_turn")

# Spoken immediately when a live action starts, so the user isn't met with 2-4s of
# dead air while the tool runs. A period keeps it a complete sentence so the TTS
# flushes/speaks it right away (before the result chunk arrives).
_ACTION_ACK = "One moment."


async def resolve_turn(
    llm: Any,
    messages: list,
    *,
    system: str | None = None,
    action_tools: list | None = None,
    executor: Callable[[str, dict], Awaitable[dict]] | None = None,
) -> AsyncIterator[str]:
    """Stream the text chunk(s) to speak this turn (nothing = stay silent).

    One streaming gate call: the model streams spoken text (→ TTS starts on the first
    sentence), calls stay_silent (→ nothing), or calls an action tool. On an action we
    ALWAYS speak: an ack (unless the model already gave a spoken preamble), then the
    streamed result — with a fallback confirmation so a tool turn never ends silent."""
    spoke = False          # did the model stream any spoken text?
    action: tuple[str, dict] | None = None
    async for ev in llm.decide_stream(messages, system=system, action_tools=action_tools):
        if ev[0] == "text":
            if ev[1]:
                spoke = True
                yield ev[1]
        elif ev[0] == "action":
            action = (ev[1], ev[2] or {})

    if action is None or executor is None:
        return  # plain spoken reply (already streamed) or stay-silent

    # --- live action: ack (if not already spoken) → execute → speak the result ------
    # Start the tool IMMEDIATELY (before the ack) so it runs WHILE the ack is spoken.
    # The await below yields control to the event loop, so the TTS can synthesize
    # "One moment." during execution instead of leaving dead air and then bundling the
    # ack together with the result at the very end.
    slug, args = action
    task = asyncio.create_task(executor(slug, args))
    if not spoke:
        yield _ACTION_ACK
    try:
        result = await task
    except asyncio.CancelledError:
        task.cancel()  # barge-in mid-action: don't leave the tool call dangling
        raise
    except Exception as exc:  # noqa: BLE001 - a failed action must not kill the turn
        _log.warning("live_action_failed", slug=slug, error=str(exc))
        yield "Sorry, I couldn't do that just now."
        return
    said_result = False
    async for delta in llm.phrase_result_stream(
        messages, system=system, slug=slug, result=result
    ):
        if delta:
            said_result = True
            yield delta
    if not said_result:
        # Never end a tool turn on just the ack — always confirm the outcome.
        yield "Okay, that's done."
