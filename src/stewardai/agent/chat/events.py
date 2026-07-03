"""Map LangGraph ``astream(..., stream_mode=["updates", "messages"])`` items to
typed client events.

``map_stream_event`` is a pure function: no I/O, no LLM/DB calls. It is
deliberately defensive (``getattr``/``dict.get`` everywhere, wrapped in a
top-level ``try/except``) because it sits directly in the hot path of a live
stream — a malformed or unrecognized chunk must degrade to ``[]``, never raise.

Observed shapes (via a throwaway spike against ``create_react_agent`` +
``ChatLiteLLM(gemini/gemini-2.5-flash)``, see task-3 report):

- ``mode == "messages"`` yields a ``(message_chunk, metadata)`` tuple.
  ``message_chunk`` is an ``AIMessage`` with the assistant's answer text in
  ``.content`` (streamed as one or more deltas), OR an ``AIMessage`` whose
  ``.content`` is empty because the chunk is tool-call-only (skip it), OR a
  ``ToolMessage`` whose ``.content`` is the *tool's* output text (not
  assistant prose — must not be surfaced as a token).
- ``mode == "updates"`` yields ``{node_name: {"messages": [...]}}``. The
  ``agent`` node's update carries an ``AIMessage``; when ``.tool_calls`` is
  non-empty the model just decided to call a tool ("started"). The ``tools``
  node's update carries one ``ToolMessage`` per executed call, with the tool
  name on ``.name`` ("done"). Rather than branch on the node name (which is
  an implementation detail of the graph), we branch on the message type
  itself so this keeps working if node names ever change.
"""
from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, ToolMessage


def _token_events(chunk: Any) -> list[dict]:
    if not isinstance(chunk, tuple) or len(chunk) != 2:
        return []
    message_chunk, _metadata = chunk
    if not isinstance(message_chunk, AIMessage) or isinstance(message_chunk, ToolMessage):
        return []
    content = getattr(message_chunk, "content", None)
    if not isinstance(content, str) or not content:
        return []
    return [{"type": "token", "delta": content}]


def _tool_call_names(message: Any) -> list[str]:
    names = []
    for call in getattr(message, "tool_calls", None) or []:
        name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
        if name:
            names.append(name)
    return names


def _activity_events(chunk: Any) -> list[dict]:
    if not isinstance(chunk, dict):
        return []
    events: list[dict] = []
    for node_update in chunk.values():
        messages = node_update.get("messages") if isinstance(node_update, dict) else None
        if not isinstance(messages, list):
            continue
        for message in messages:
            if isinstance(message, ToolMessage):
                name = getattr(message, "name", None) or "unknown"
                events.append(
                    {"type": "activity", "kind": "tool", "name": name, "status": "done"}
                )
            elif isinstance(message, AIMessage):
                for name in _tool_call_names(message):
                    events.append(
                        {"type": "activity", "kind": "tool", "name": name, "status": "started"}
                    )
    return events


def map_stream_event(mode: str, chunk: Any) -> list[dict]:
    """Convert one ``(mode, chunk)`` item from ``agent.astream(...)`` into
    zero or more typed client events. Never raises."""
    try:
        if mode == "messages":
            return _token_events(chunk)
        if mode == "updates":
            return _activity_events(chunk)
        return []
    except Exception:
        return []
