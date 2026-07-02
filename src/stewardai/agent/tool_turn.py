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
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.tool_turn")

# Spoken immediately when a live action starts, so the user isn't met with 2-4s of
# dead air while the tool runs. A period keeps it a complete sentence so the TTS
# flushes/speaks it right away (before the result chunk arrives).
_ACTION_ACK = "One moment."

# Rotated, deliberately DISFLUENT fillers spoken when the model is slow to first output
# (e.g. Gemini overloaded) so a slow turn isn't dead air. The "Hmm/Umm" + ellipsis make
# the TTS render a natural, thinking cadence (no SSML needed). Varied so it isn't robotic.
_SLOW_FILLERS = (
    "Hmm, let me see...",
    "Umm, one moment...",
    "Let me think...",
    "Okay, just a sec...",
)


async def resolve_turn(
    llm: Any,
    messages: list,
    *,
    system: str | None = None,
    action_tools: list | None = None,
    executor: Callable[[str, dict], Awaitable[dict]] | None = None,
    slow_filler_s: float = 0.0,
) -> AsyncIterator[str]:
    """Stream the text chunk(s) to speak this turn (nothing = stay silent).

    One streaming gate call: the model streams spoken text (→ TTS starts on the first
    sentence), calls stay_silent (→ nothing), or calls an action tool. On an action we
    ALWAYS speak: an ack (unless the model already gave a spoken preamble), then the
    streamed result — with a fallback confirmation so a tool turn never ends silent.

    ``slow_filler_s`` > 0: if the model produces no output within that many seconds,
    speak one short disfluent filler ("Hmm, let me see...") so a slow/overloaded turn
    isn't dead air. It does NOT cancel the in-flight call — the real reply streams after.
    Pass 0 to disable; the caller passes 0 on turns the bot wasn't addressed on, so an
    overloaded AMBIENT turn never blurts a filler."""
    spoke = False          # did the model stream any spoken text (or a filler)?
    action: tuple[str, dict] | None = None
    filler_said = False
    aiter = llm.decide_stream(
        messages, system=system, action_tools=action_tools
    ).__aiter__()
    pending: asyncio.Task | None = None
    while True:
        if pending is None:
            pending = asyncio.ensure_future(aiter.__anext__())
        # Before ANY output, wait up to slow_filler_s for the first event; if it's slow,
        # speak one filler (WITHOUT cancelling the call) and keep waiting for the reply.
        if slow_filler_s > 0 and not spoke and action is None and not filler_said:
            done, _ = await asyncio.wait({pending}, timeout=slow_filler_s)
            if not done:
                filler_said = True
                spoke = True  # so the action path below won't add a SECOND ack
                _log.info("slow_reply_filler", after_s=slow_filler_s)
                yield random.choice(_SLOW_FILLERS)
                continue
        try:
            ev = await pending
        except StopAsyncIteration:
            break
        finally:
            pending = None
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


async def stream_with_slow_filler(
    source: AsyncIterator[str], *, slow_filler_s: float = 0.0
) -> AsyncIterator[str]:
    """Wrap a plain text-delta stream with the SAME slow-reply filler as the gated path:
    if the FIRST delta doesn't arrive within ``slow_filler_s``, speak one disfluent
    filler (WITHOUT cancelling the stream), then yield the real deltas. 0 disables.

    Lets the ungated / generic voice agent get 'no dead air on a slow reply' too, with
    the identical fillers + threshold as ``resolve_turn``."""
    aiter = source.__aiter__()
    pending: asyncio.Task | None = None
    filler_said = False
    while True:
        if pending is None:
            pending = asyncio.ensure_future(aiter.__anext__())
        if slow_filler_s > 0 and not filler_said:
            done, _ = await asyncio.wait({pending}, timeout=slow_filler_s)
            if not done:
                filler_said = True
                _log.info("slow_reply_filler", after_s=slow_filler_s)
                yield random.choice(_SLOW_FILLERS)
                continue
        try:
            delta = await pending
        except StopAsyncIteration:
            break
        finally:
            pending = None
        if delta:
            yield delta
