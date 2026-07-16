"""The agentic-chat LangGraph agent + streaming turn entrypoint.

``build_chat_agent`` wires T1's chat model (:func:`stewardai.agent.chat.models.
make_chat_llm`) and T2's read-only tools (:func:`stewardai.agent.chat.tools.
build_read_tools`) into a ReAct-style tool-calling agent. ``run_chat_turn`` is
now a thin, back-compat wrapper (Plan C2): it builds a one-shot
:class:`stewardai.agent.chat.session.ChatSession` scoped to a fresh
``thread_id`` and read-only tools, then delegates to its
``stream_turn`` -- so callers that only ever ran a single, non-resumable turn
(``scripts/chat_smoke.py``, the C1 tests) keep working unchanged. Anything
that needs write tools, permission interrupts, or multi-turn resume (the C2
``/ws/chat`` orchestration) should build and hold onto a ``ChatSession``
itself instead of calling this function.

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

from stewardai.agent.chat.tools import CiteRegistry, build_read_tools

SYSTEM = (
    "You are Steward, the user's personal assistant over their meetings, knowledge base, "
    "and work. Use your tools proactively to find real information before answering — do NOT "
    "ask the user for details you can look up yourself. "
    "GROUND EVERY FACTUAL CLAIM in your tools' actual returned results. Cite a claim with [n] "
    "ONLY when it comes directly from returned passage n — never attach a citation to something a "
    "passage does not actually say. If your tools return nothing relevant to what was asked — e.g. "
    "a named meeting has no transcript or summary yet, or the search finds no matching passages — "
    "SAY SO plainly (e.g. \"I don't have any recorded content for that meeting yet\") and stop. "
    "NEVER invent meeting content, participant names, decisions, or action items, and never blend "
    "one meeting's content into an answer about a different meeting. Better to say you don't "
    "know than to fabricate. "
    "Never mention tool names, schemas, JSON, or that a tool was called — just answer naturally. "
    "Be concise.\n\n"
    "You always know the current date (given below) — never ask the user for it.\n\n"
    "FIRST understand intent. MOST messages are QUESTIONS to answer from the user's meetings and "
    "knowledge base (e.g. 'what are my open action items', 'summarize the Acme call', 'what did we "
    "decide') — answer them DIRECTLY via your read tools (kb_search, list_meetings, list_spaces, "
    "lookup_entity, list_calendar_events). Do NOT draft or send an email, create a calendar event, "
    "or take ANY outward/external-app action unless the user EXPLICITLY asks you to send/create/do "
    "it. For example, 'give me my open action items' means LIST them in your reply — never turn it "
    "into an email draft. When unsure whether the user wants information or an action, answer with "
    "the information and ask what they'd like done.\n\n"
    "ONCE the user has actually asked you to DO something (send an email, create a calendar event, "
    "etc.), do NOT interrogate them field-by-field in chat. Instead call the right tool now "
    "with your best draft — fill in what you can infer and leave reasonable placeholders for "
    "anything unknown. The user is shown an editable approval card where they review and fix "
    "the details before it runs, so proposing a draft is always better than asking questions.\n\n"
    "External apps (email, calendar, docs, etc.) are accessed through three tools. Which apps are "
    "available is dynamic — call list_integrations() to see the available apps and whether each is "
    "connected. To DO something, call describe_action(app) for that app's action slugs + "
    "arguments, then run_integration_action(app, action, args_json) with args_json as a JSON "
    "object string — always attempt it; if the app isn't connected the system shows a Connect "
    "prompt automatically, so don't refuse or ask the user to connect first. To ANSWER whether you "
    "can access/use an app, call list_integrations() and report the truth — NEVER assume. If an "
    "app isn't in list_integrations, tell the user it's not supported yet. When the user wants to "
    "connect an app (or asks how), call connect_app(app) — it shows the Connect dialog. NEVER tell "
    "the user to click a Connect button unless you actually called connect_app or "
    "run_integration_action."
)


def build_chat_agent(llm, tools, system: str = SYSTEM):  # noqa: ANN001
    """Build the tool-calling chat agent with in-memory per-turn checkpointing.

    ``system`` lets the caller inject a dated/per-session prompt (see
    :class:`~stewardai.agent.chat.session.ChatSession`)."""
    return create_react_agent(llm, tools, prompt=system, checkpointer=InMemorySaver())


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


def _collect_citations(
    mode: str,
    chunk: object,
    citations: list[dict],
    seen: dict[tuple, int],
) -> None:
    """Scan one ``(mode, chunk)`` item from ``agent.astream(...,
    stream_mode=["updates", ...])`` for a completed ``kb_search`` tool call and
    append its passages to ``citations`` in place. Defensive: never raises.

    ``kb_search`` numbers the passages it returns via a shared, turn-scoped
    ``CiteRegistry`` (see :mod:`stewardai.agent.chat.tools`), so its ``n`` is
    already a stable, turn-global identity -- the SAME number the model saw
    and may later cite as ``[n]``. That number is trusted as-is here (NOT
    reassigned) so the stored citation's ``n`` always matches what the model
    was shown. ``seen`` maps ``(meeting_id, source_seq)`` -> the ``n`` it was
    first assigned, so a passage retrieved again (e.g. by a second,
    overlapping ``kb_search`` call) is deduped onto its original citation
    entry instead of being appended twice.
    """
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
                    key = (p.get("meeting_id"), p.get("source_seq"))
                    if key in seen:
                        continue
                    n = p.get("n")
                    seen[key] = n
                    citations.append(
                        {
                            "n": n,
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
    model itself, which is built (via T1's ``make_chat_llm("reasoning",
    tools=...)``) inside the :class:`~stewardai.agent.chat.session.ChatSession`
    this delegates to.

    ``history`` is a list of ``{"role","content"}`` dicts prepended to the new
    user ``message`` as the agent's input. Each call builds a one-shot session
    scoped to a fresh LangGraph thread id and read-only tools only (in-memory
    checkpointing is per-session here; the caller is responsible for
    persisting/re-supplying ``history`` across turns) -- so this never itself
    resumes an interrupt. Callers that need writes/permissions/resume should
    build a ``ChatSession`` directly instead.
    """
    # Local import: session.py imports this module at top level (so it can
    # resolve ``build_chat_agent``/``_collect_citations`` off the live module
    # object -- see session.py's module docstring), so importing ChatSession
    # back here at module level would be a circular import.
    from stewardai.agent.chat.session import ChatSession

    tools = build_read_tools(client, llm_reasoning, user_id=user_id, cite_registry=CiteRegistry())
    session = ChatSession(
        client, llm_reasoning, user_id=user_id, thread_id=str(uuid.uuid4()), tools=tools
    )
    async for event in session.stream_turn(message, history):
        yield event
