"""``ChatSession``: a persistent, interrupt-aware agentic-chat turn driver.

Plan C1's ``run_chat_turn`` (see :mod:`stewardai.agent.chat.graph`) built a
fresh LangGraph agent + ``InMemorySaver`` checkpoint on every call -- fine for
read-only chat, where a turn always runs to completion in one shot. Plan C2
adds tool-gated writes (:mod:`stewardai.agent.chat.permissions`) whose
``gate()`` can raise a LangGraph ``interrupt()`` mid-turn to ask the human for
a decision (approve/reject/always-allow an outward action, or connect an
integration). Resuming a paused interrupt requires the *same* agent +
checkpointer + thread id that raised it -- that's where the paused graph
state lives -- so the agent can no longer be rebuilt per call. ``ChatSession``
builds it once, at construction, and is reused across an arbitrary number of
``stream_turn``/``resume`` calls against one fixed ``thread_id``.

**Verified interrupt/resume shape (from a spike, see task-3 report):** under
``stream_mode=["updates", "messages"]``, a tool calling
``langgraph.types.interrupt(payload)`` surfaces as one
``("updates", {"__interrupt__": (Interrupt(value=payload),)})`` item and the
graph then pauses -- nothing more will arrive on that stream, so the loop
must stop there and hand ``payload`` up to the caller. Resuming re-streams on
the *same* thread with ``langgraph.types.Command(resume=decision)`` as the
input instead of a fresh ``{"messages": [...]}``; normal streaming continues
from where it left off and may hit another interrupt or run to completion.

This module imports :mod:`stewardai.agent.chat.graph` at module level (not
just ``build_chat_agent``/``_collect_citations`` by name) so that both call
sites -- this file's ``ChatSession.__init__`` and ``graph.run_chat_turn``'s
back-compat wrapper -- resolve ``build_chat_agent`` off the *same* live
module object. That keeps the pre-existing C1 tests' ``monkeypatch.setattr(
graph_module, "build_chat_agent", ...)`` working unchanged after the C2
refactor, since a monkeypatched module attribute is only visible to code that
looks it up dynamically (``chat_graph.build_chat_agent``), not to a
``from graph import build_chat_agent`` binding taken at import time.
"""
from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC
from typing import Any

from langgraph.errors import GraphBubbleUp
from langgraph.types import Command

from stewardai.agent.chat import graph as chat_graph
from stewardai.agent.chat.events import map_stream_event
from stewardai.agent.chat.models import make_chat_llm
from stewardai.agent.chat.tools import build_read_tools
from stewardai.common.logging import get_logger
from stewardai.observability.usage_context import usage_scope

_log = get_logger("agent.chat.session")


def _parse_followups(text: str) -> list[str]:
    """Defensively parse the follow-ups LLM call's raw text into a list of
    short strings. Strips a wrapping ```/```json code fence if present;
    anything that isn't valid JSON, or isn't a JSON array of strings, yields
    an empty list -- never raises. Capped at 3 entries."""
    if not text:
        return []
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if "\n" in cleaned:
            first, rest = cleaned.split("\n", 1)
            cleaned = rest if first.strip().isalpha() else cleaned
    try:
        data = json.loads(cleaned)
    except Exception:  # noqa: BLE001 - malformed JSON → no follow-ups
        return []
    if not isinstance(data, list):
        return []
    items = [s.strip() for s in data if isinstance(s, str) and s.strip()]
    return items[:3]


async def _generate_followups(question: str, answer: str) -> list[str]:
    """Best-effort: one small, cheap LLM call asking for 2-3 short, specific
    follow-up questions the user is likely to ask next, given this turn's
    question + answer. Called AFTER the answer stream has completed, so it
    never adds latency to the answer itself. Fully defensive: any failure
    (LLM error, bad/unexpected JSON) yields an empty list rather than
    raising -- a follow-up generation problem must never break the turn."""
    if not question.strip() or not answer.strip():
        return []
    try:
        llm = make_chat_llm("utility")
        prompt = (
            "Given the user's question and the assistant's answer below, suggest 2-3 "
            "short, specific follow-up questions the user is likely to ask next, "
            "answerable from their meetings/work.\n\n"
            f"Question: {question}\n\nAnswer: {answer}\n\n"
            "Return ONLY a JSON array of strings -- no prose, no markdown fences."
        )
        resp = await llm.ainvoke(prompt)
        text = _content_text(getattr(resp, "content", resp))
        return _parse_followups(text)
    except Exception as exc:  # noqa: BLE001 - never let follow-ups break the turn
        _log.warning("chat_followups_error", error=str(exc))
        return []


def _content_text(content: Any) -> str:
    """Extract plain text from a LangChain message ``content``, which for
    reasoning models can be a list of blocks (``[{"type": "text", "text": ...},
    ...]``) rather than a plain string."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "".join(parts)
    return ""


class ChatSession:
    """One user's agentic-chat conversation: a persistent LangGraph agent +
    ``InMemorySaver`` checkpoint bound to a fixed ``thread_id``, built once
    and reused across turns so a tool-permission interrupt raised mid-turn
    can be resumed later against the same paused graph state.
    """

    def __init__(
        self,
        client,  # noqa: ANN001
        llm,  # noqa: ANN001
        *,
        user_id: str,
        thread_id: str,
        tools: list | None = None,
        tz: str | None = None,
        scope_space_id: str | None = None,
        scope_kind: str | None = None,
        scope_label: str | None = None,
    ) -> None:
        """Build the agent ONCE. ``llm`` is the app's ``LiteLLMClient`` (used
        for embeddings inside ``kb_search``'s ``retrieve()`` -- not the chat
        model itself, which is built here via ``make_chat_llm("reasoning",
        tools=...)``). ``tools`` is the full toolset this session's agent may
        call: pass read-only tools for back-compat (``run_chat_turn``), or
        read+write(+Composio) tools for a real interactive session (the WS);
        defaults to read-only tools if omitted.

        ``scope_space_id``/``scope_kind``/``scope_label`` reflect the
        composer's "Ask about this space"-style scope selector, if any. A
        ``"space"`` scope is a real retrieval constraint (see
        ``build_read_tools``'s ``scope_space_id``, applied by the caller when
        it builds ``tools`` -- this constructor only uses ``scope_kind``/
        ``scope_label`` to add a system-prompt hint). A ``"meeting"`` scope
        has no retrieval-side filter (kb_search has no meeting_id parameter),
        so it's a prompt hint only. All three are optional and default to no
        scope, matching prior behavior exactly.
        """
        self.client = client
        self.llm = llm
        self.user_id = user_id
        self.thread_id = thread_id
        self.tools = (
            tools
            if tools is not None
            else build_read_tools(client, llm, user_id=user_id, scope_space_id=scope_space_id)
        )
        from datetime import datetime

        tzinfo, tzlabel = UTC, "UTC"
        if tz:
            try:
                from zoneinfo import ZoneInfo

                tzinfo, tzlabel = ZoneInfo(tz), tz
            except Exception:  # noqa: BLE001 - bad/unknown tz → fall back to UTC
                tzinfo, tzlabel = UTC, "UTC"
        now = datetime.now(tzinfo).strftime("%A, %B %d, %Y at %I:%M %p")
        system = (
            f"{chat_graph.SYSTEM}\n\n"
            f"The current date and time is {now} ({tzlabel}). The user's timezone is "
            f"{tzlabel} — always present dates and times in this timezone (convert from "
            f"UTC or an event's own offset as needed); do not show raw UTC unless asked."
        )
        if scope_kind == "space" and scope_label:
            system += (
                f"\n\nThe user has scoped this conversation to the space \"{scope_label}\". "
                "Search and answer ONLY within that space; if it has no relevant captured "
                "content, say so plainly rather than guessing."
            )
        elif scope_kind == "meeting" and scope_label:
            system += (
                f"\n\nThe user has scoped this to the meeting \"{scope_label}\". Focus on "
                "that meeting (use list_meetings / kb_search); if you can't find it or it "
                "has no relevant captured content, say so plainly rather than guessing."
            )
        chat_llm = make_chat_llm("reasoning", tools=self.tools)
        self._agent = chat_graph.build_chat_agent(chat_llm, self.tools, system=system)
        self._config = {"configurable": {"thread_id": thread_id}}

    async def stream_turn(self, message: str, history: list[dict]) -> AsyncIterator[dict]:
        """Run one new turn: ``history`` + ``message`` becomes the agent's
        input on this session's thread. Streams typed events and normally
        ends in ``done`` -- unless a tool interrupts mid-turn, in which case
        it ends in ``permission_request``/``connect_required`` instead (call
        :meth:`resume` with the human's decision to continue this turn).
        """
        messages = [*history, {"role": "user", "content": message}]
        # One request_id per turn groups all its LLM calls in usage_logs; resume
        # reuses it so a permission/connect round-trip stays one logical request.
        self._request_id = str(uuid.uuid4())
        with usage_scope(
            feature="chat",
            user_id=self.user_id,
            thread_id=self.thread_id,
            request_id=self._request_id,
        ):
            stream = self._agent.astream(
                {"messages": messages}, self._config, stream_mode=["updates", "messages"]
            )
            async for event in self._drive(stream):
                yield event

    async def resume(self, decision: Any) -> AsyncIterator[dict]:
        """Continue a turn that a prior ``stream_turn``/``resume`` call left
        paused on an interrupt, feeding it the human's ``decision`` (e.g.
        ``"approve"``/``"reject"``/``"always"``, or a connect-flow result).
        Same event shape as :meth:`stream_turn`: may end in ``done``, or hit
        another interrupt and end in ``permission_request``/
        ``connect_required`` again.
        """
        with usage_scope(
            feature="chat",
            user_id=self.user_id,
            thread_id=self.thread_id,
            request_id=getattr(self, "_request_id", None) or str(uuid.uuid4()),
        ):
            stream = self._agent.astream(
                Command(resume=decision), self._config, stream_mode=["updates", "messages"]
            )
            async for event in self._drive(stream):
                yield event

    async def _drive(self, stream: AsyncIterator[tuple[str, Any]]) -> AsyncIterator[dict]:
        """Shared event loop for ``stream_turn``/``resume``: map every chunk
        to typed client events and collect ``kb_search`` citations exactly
        like C1's ``run_chat_turn`` did -- except a ``__interrupt__`` update
        suspends the turn (yield one connect/permission event, then return)
        instead of running to a ``done``. Defensive: an unexpected error while
        draining the stream yields an ``error`` event rather than raising.
        """
        citations: list[dict] = []
        seen_citations: dict[tuple, int] = {}
        accumulated = ""
        thinking = ""
        # Wall-clock of the reasoning phase: from the first thinking delta to the
        # first answer token (≈ "time until it started answering", which is what
        # the UI's "Thought for Ns" reports). None until a reasoning model streams.
        t_first_think: float | None = None
        t_answer_start: float | None = None
        activities: dict[tuple, dict] = {}  # (kind, name) -> latest {kind,name,status}
        try:
            async for mode, chunk in stream:
                if mode == "updates" and isinstance(chunk, dict) and "__interrupt__" in chunk:
                    event = self._interrupt_event(chunk)
                    if event is not None:
                        yield event
                    return
                chat_graph._collect_citations(mode, chunk, citations, seen_citations)
                for event in map_stream_event(mode, chunk):
                    if event.get("type") == "token":
                        if t_answer_start is None:
                            t_answer_start = time.monotonic()
                        accumulated += event.get("delta", "")
                    elif event.get("type") == "thinking":
                        if t_first_think is None:
                            t_first_think = time.monotonic()
                        thinking += event.get("delta", "")
                    elif event.get("type") == "activity":
                        activities[(event.get("kind"), event.get("name"))] = {
                            "kind": event.get("kind"),
                            "name": event.get("name"),
                            "status": event.get("status"),
                        }
                    yield event
        except GraphBubbleUp:
            # interrupt()/subgraph control-flow signals MUST propagate to LangGraph
            # (they drive the permission pause) — never swallow them as an error.
            raise
        except Exception as exc:  # never let a mid-stream error kill the caller
            _log.warning("chat_stream_error", error=str(exc))
            yield {"type": "error", "message": "something went wrong on this turn"}
            return

        # The authoritative answer is the FINAL assistant message — NOT the
        # accumulated stream, which concatenates text the model emitted across
        # multiple tool-call rounds (e.g. an interim "I can't access that,
        # connect it" from a connect round + the real answer from a later
        # round). `_content_text` handles reasoning models whose content is a
        # list of blocks (str check alone missed those → fell back to the
        # concatenation). Fall back to `accumulated` only if state is unavailable.
        answer = ""
        question = ""
        try:
            state = await self._agent.aget_state(self._config)
            msgs = state.values["messages"]
            answer = _content_text(msgs[-1].content)
            # The most recent human turn, for the follow-ups prompt below --
            # best-effort (crude type check on the LangChain message), never
            # raises past this try/except.
            for m in reversed(msgs):
                if getattr(m, "type", None) == "human":
                    question = _content_text(m.content)
                    break
        except Exception:
            pass
        if not answer.strip():
            answer = accumulated

        # Safety net: a turn that completes with no text at all (e.g. the model
        # returned an empty candidate) must never render as a blank message.
        if not (answer or "").strip():
            _log.warning("chat_empty_answer", thread_id=self.thread_id)
            answer = "I wasn't able to generate a response — could you rephrase or try again?"

        thinking_seconds: int | None = None
        if t_first_think is not None:
            end = t_answer_start if t_answer_start is not None else time.monotonic()
            thinking_seconds = max(1, round(end - t_first_think))

        # Suggested follow-ups: one cheap LLM call AFTER the answer is complete
        # (never blocks/slows the answer stream itself). Yielded as its own
        # event before `done` so the client can attach `items` to the message
        # it's about to mark done; defensive by construction (see
        # `_generate_followups`) so this can never fail the turn.
        followups = await _generate_followups(question, answer)
        yield {"type": "followups", "call_id": self.thread_id, "items": followups}

        yield {
            "type": "done",
            "answer": answer,
            "citations": citations,
            "activities": list(activities.values()),
            "thinking": thinking,
            "thinking_seconds": thinking_seconds,
        }

    def _interrupt_event(self, chunk: dict) -> dict | None:
        """Build the one client event for a ``__interrupt__`` update.

        The interrupt's ``.value`` (set by ``langgraph.types.interrupt(
        payload)``, see :func:`stewardai.agent.chat.permissions.gate`) is a
        dict carrying at least ``kind`` (``"permission"`` or ``"connect"``)
        plus whatever else the caller passed (e.g. ``tool``, args); it's
        spread into the event alongside a ``type`` (mapped from ``kind``) and
        ``call_id`` (this session's ``thread_id``, so the client can
        correlate a later :meth:`resume` decision back to this paused turn).
        Returns ``None`` (nothing to yield) if the chunk isn't shaped as
        expected -- never raises.
        """
        try:
            raw = chunk["__interrupt__"][0].value
        except (KeyError, IndexError, AttributeError, TypeError):
            return None
        payload = raw if isinstance(raw, dict) else {}
        kind = payload.get("kind")
        event_type = "connect_required" if kind == "connect" else "permission_request"
        return {"type": event_type, "call_id": self.thread_id, **payload}
