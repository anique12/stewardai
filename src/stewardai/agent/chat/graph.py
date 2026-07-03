"""The agentic-chat LangGraph agent + streaming turn entrypoint.

``build_chat_agent`` wires T1's chat model (:func:`stewardai.agent.chat.models.
make_chat_llm`) and T2's read-only tools (:func:`stewardai.agent.chat.tools.
build_read_tools`) into a ReAct-style tool-calling agent. ``run_chat_turn`` runs
one turn of that agent, streaming typed client events (via T3's
:func:`stewardai.agent.chat.events.map_stream_event`) and ending in a terminal
``done`` event carrying the final answer + any knowledge-base citations used.

**Agent API choice:** LangGraph v1.0 deprecates ``langgraph.prebuilt.
create_react_agent`` in favor of ``langchain.agents.create_agent`` (confirmed
live: a ``LangGraphDeprecatedSinceV10`` warning fires on first use). However
this project does not depend on the ``langchain`` meta-package at all --  only
``langchain-core``, ``langgraph``, and ``langchain-litellm`` are installed --
so ``langchain.agents.create_agent`` is not importable here
(``ModuleNotFoundError: No module named 'langchain'``). ``create_react_agent``
is therefore the only working option, and it is spike-proven (see task-3
report and this task's report) against the exact installed versions
(langgraph 1.2.7, langchain-core 1.4.8, langchain-litellm 0.7.0) with
``ChatLiteLLM(gemini/gemini-2.5-flash)``. Its ``prompt=`` kwarg still accepts
a plain system-prompt string in this version.
"""
from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.prebuilt import create_react_agent

from stewardai.agent.chat.events import map_stream_event
from stewardai.agent.chat.models import make_chat_llm
from stewardai.agent.chat.tools import build_read_tools

SYSTEM = (
    "You are Steward, the user's personal assistant over their meetings, knowledge base, "
    "and work. Use your tools proactively to find real information before answering — do NOT "
    "ask the user for details you can look up yourself. When you use knowledge-base passages, "
    "cite each claim with [n] matching the passage numbers, and never invent facts not in the "
    "tools' results. Never mention tool names, schemas, JSON, or that a tool was called — just "
    "answer naturally. Be concise."
)


def build_chat_agent(llm, tools):  # noqa: ANN001
    """Build the tool-calling chat agent with in-memory per-turn checkpointing."""
    return create_react_agent(llm, tools, prompt=SYSTEM, checkpointer=InMemorySaver())


def _parse_kb_passages(content: object) -> list[dict] | None:
    """Best-effort parse of a ``kb_search`` ``ToolMessage.content`` into its
    ``passages`` list. ``content`` may already be a dict (direct tool return)
    or a JSON-encoded string (typical over the wire) -- never raises."""
    payload = content
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            return None
    if not isinstance(payload, dict):
        return None
    passages = payload.get("passages")
    return passages if isinstance(passages, list) else None


def _collect_citations(mode: str, chunk: object, citations: list[dict]) -> None:
    """Scan one ``(mode, chunk)`` item from ``agent.astream(...,
    stream_mode=["updates", ...])`` for a completed ``kb_search`` tool call and
    append its passages to ``citations`` in place. Defensive: never raises."""
    try:
        if mode != "updates" or not isinstance(chunk, dict):
            return
        for node_update in chunk.values():
            messages = node_update.get("messages") if isinstance(node_update, dict) else None
            if not isinstance(messages, list):
                continue
            for message in messages:
                if not isinstance(message, ToolMessage) or message.name != "kb_search":
                    continue
                passages = _parse_kb_passages(message.content)
                if not passages:
                    continue
                for p in passages:
                    if not isinstance(p, dict):
                        continue
                    citations.append(
                        {
                            "meeting_id": p.get("meeting_id"),
                            "source_seq": p.get("source_seq"),
                            "kind": p.get("kind"),
                            "text": p.get("text"),
                        }
                    )
    except Exception:
        return


async def run_chat_turn(
    client,  # noqa: ANN001
    llm_reasoning,  # noqa: ANN001
    *,
    user_id: str,
    history: list[dict],
    message: str,
) -> AsyncIterator[dict]:
    """Run one agentic-chat turn, streaming typed events, ending in a ``done``.

    ``llm_reasoning`` is the app's ``LiteLLMClient``, used for embeddings
    inside ``kb_search``'s ``retrieve()`` call (T2) -- it is *not* the chat
    model itself, which is built here via T1's ``make_chat_llm("reasoning",
    tools=...)``.

    ``history`` is a list of ``{"role","content"}`` dicts prepended to the new
    user ``message`` as the agent's input. Each turn gets a fresh LangGraph
    thread id (in-memory checkpointing is per-process/per-turn here; the
    caller is responsible for persisting/re-supplying ``history`` across
    turns).
    """
    tools = build_read_tools(client, llm_reasoning, user_id=user_id)
    chat_llm = make_chat_llm("reasoning", tools=tools)
    agent = build_chat_agent(chat_llm, tools)

    messages = [*history, {"role": "user", "content": message}]
    config = {"configurable": {"thread_id": str(uuid.uuid4())}}

    citations: list[dict] = []
    accumulated = ""
    async for mode, chunk in agent.astream(
        {"messages": messages}, config, stream_mode=["updates", "messages"]
    ):
        _collect_citations(mode, chunk, citations)
        for event in map_stream_event(mode, chunk):
            if event.get("type") == "token":
                accumulated += event.get("delta", "")
            yield event

    answer = accumulated
    try:
        state = await agent.aget_state(config)
        last_message = state.values["messages"][-1]
        content = last_message.content
        if isinstance(content, str) and content:
            answer = content
    except Exception:
        pass

    yield {"type": "done", "answer": answer, "citations": citations}
