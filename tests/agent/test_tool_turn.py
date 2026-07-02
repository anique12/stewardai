"""resolve_turn — streaming gate + reply (pure, no livekit).

Locks: stay silent, streamed spoken text, and the action flow (ack → execute →
streamed result), including the "always speak on a tool turn" guarantees — model
preamble replaces the ack, failures apologize, empty results fall back to a
confirmation (never end on just the ack).
"""

from __future__ import annotations

import asyncio

from stewardai.agent.tool_turn import _ACTION_ACK, _SLOW_FILLERS, resolve_turn


async def _collect(gen) -> list:  # noqa: ANN001
    return [c async for c in gen]


class _LLM:
    """Drives resolve_turn via a scripted decide_stream event list.

    events: list of ('text', delta) and/or ('action', slug, args).
    phrase_words: streamed one-by-one from phrase_result_stream (empty tuple = no
    output, to exercise the fallback).
    """

    def __init__(self, events: list, phrase_words: tuple = ("Here's", "the", "result.")) -> None:
        self._events = events
        self._phrase_words = phrase_words
        self.decide_action_tools = "unset"
        self.phrase_calls: list = []

    async def decide_stream(self, messages, *, system=None, action_tools=None):  # noqa: ANN001
        self.decide_action_tools = action_tools
        for ev in self._events:
            yield ev

    async def phrase_result_stream(self, messages, *, system=None, slug=None, result=None):  # noqa: ANN001
        self.phrase_calls.append((slug, result))
        for w in self._phrase_words:
            if w:
                yield w + " "


async def test_stay_silent_yields_nothing():
    llm = _LLM(events=[])  # decide_stream yields nothing = stay silent
    assert await _collect(resolve_turn(llm, [], system="s")) == []


async def test_plain_speak_streams_text_no_phrasing():
    llm = _LLM(events=[("text", "Hel"), ("text", "lo!")])
    out = await _collect(resolve_turn(llm, [], system="s"))
    assert "".join(out) == "Hello!"
    assert llm.phrase_calls == []  # no action -> no result phrasing


async def test_action_acks_then_executes_then_streams_result():
    llm = _LLM(
        events=[("action", "GOOGLECALENDAR_EVENTS_LIST", {"x": 1})],
        phrase_words=("You", "have", "2", "meetings."),
    )
    executed: list = []

    async def executor(slug, args):  # noqa: ANN001
        assert executed == []  # the ack is yielded BEFORE we execute
        executed.append((slug, args))
        return {"successful": True, "data": {"events": 2}}

    out = await _collect(
        resolve_turn(llm, [], system="s", action_tools=[{"t": 1}], executor=executor)
    )
    assert executed == [("GOOGLECALENDAR_EVENTS_LIST", {"x": 1})]
    assert out[0] == _ACTION_ACK
    assert "".join(out[1:]).strip() == "You have 2 meetings."
    assert llm.decide_action_tools == [{"t": 1}]  # tools offered to the gate


async def test_action_with_spoken_preamble_skips_the_ack():
    llm = _LLM(events=[("text", "Let me check. "), ("action", "X", {})], phrase_words=("Done.",))

    async def executor(slug, args):  # noqa: ANN001
        return {"ok": True}

    out = await _collect(
        resolve_turn(llm, [], system="s", action_tools=[{}], executor=executor)
    )
    assert out[0] == "Let me check. "  # the model's own preamble is spoken
    assert _ACTION_ACK not in out       # ...so we do NOT add a duplicate ack
    assert "Done." in "".join(out)


async def test_action_without_executor_yields_nothing():
    llm = _LLM(events=[("action", "X", {})])
    out = await _collect(resolve_turn(llm, [], system="s", action_tools=[{}], executor=None))
    assert out == []


async def test_action_failure_acks_then_apologizes():
    llm = _LLM(events=[("action", "X", {})])

    async def executor(slug, args):  # noqa: ANN001
        raise RuntimeError("boom")

    out = await _collect(
        resolve_turn(llm, [], system="s", action_tools=[{}], executor=executor)
    )
    assert out[0] == _ACTION_ACK
    assert "couldn't" in "".join(out).lower()


async def test_action_empty_result_falls_back_to_confirmation():
    # phrase_result_stream yields nothing -> must NOT end on just the ack.
    llm = _LLM(events=[("action", "X", {})], phrase_words=())

    async def executor(slug, args):  # noqa: ANN001
        return {"ok": True}

    out = await _collect(
        resolve_turn(llm, [], system="s", action_tools=[{}], executor=executor)
    )
    assert out[0] == _ACTION_ACK
    assert "done" in "".join(out).lower()  # fallback confirmation spoken


class _SlowLLM:
    """decide_stream that waits ``delay`` before yielding its (scripted) events."""

    def __init__(self, delay: float, events: list, phrase_words: tuple = ("Done.",)) -> None:
        self._delay = delay
        self._events = events
        self._phrase_words = phrase_words

    async def decide_stream(self, messages, *, system=None, action_tools=None):  # noqa: ANN001
        await asyncio.sleep(self._delay)
        for ev in self._events:
            yield ev

    async def phrase_result_stream(self, messages, *, system=None, slug=None, result=None):  # noqa: ANN001
        for w in self._phrase_words:
            if w:
                yield w + " "


async def test_slow_reply_speaks_a_filler_first_then_the_real_reply():
    llm = _SlowLLM(delay=0.05, events=[("text", "Here is the answer.")])
    out = await _collect(resolve_turn(llm, [], system="s", slow_filler_s=0.01))
    assert out[0] in _SLOW_FILLERS                       # slow -> filler spoken first
    assert "".join(out[1:]) == "Here is the answer."      # real reply still follows


async def test_fast_reply_gets_no_filler():
    llm = _SlowLLM(delay=0.0, events=[("text", "Quick.")])
    out = await _collect(resolve_turn(llm, [], system="s", slow_filler_s=0.5))
    assert out == ["Quick."]                              # beat the timer -> no filler


async def test_filler_disabled_by_default():
    llm = _SlowLLM(delay=0.05, events=[("text", "Answer.")])
    out = await _collect(resolve_turn(llm, [], system="s"))  # slow_filler_s defaults to 0
    assert out == ["Answer."]                             # no filler even though slow


async def test_slow_action_filler_replaces_the_ack():
    # Slow to first event AND it's an action: the filler fires, and the action path must
    # NOT add a SECOND ack — just the filler, then the result.
    llm = _SlowLLM(delay=0.05, events=[("action", "X", {})], phrase_words=("Done.",))

    async def executor(slug, args):  # noqa: ANN001
        return {"ok": True}

    out = await _collect(
        resolve_turn(llm, [], system="s", action_tools=[{}], executor=executor, slow_filler_s=0.01)
    )
    assert out[0] in _SLOW_FILLERS
    assert _ACTION_ACK not in out            # filler replaced the ack (no double)
    assert "Done." in "".join(out)
