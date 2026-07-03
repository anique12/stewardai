"""Pure conversions for the native LiveKit function-tool meeting path.

The meeting LLM node lets LiveKit manage the speak→tool→speak loop natively (so a
preamble is a SEPARATE spoken utterance before the tool runs, then the result is
its own utterance — fixing the "ack bundled with result" bug). To do that our
custom ``LLMStream`` must talk to litellm in OpenAI shape:

  * ``chat_ctx_to_oai_messages`` — a livekit ``ChatContext``'s items (plain
    messages + ``FunctionCall`` / ``FunctionCallOutput`` from the tool-result
    follow-up pass) → OpenAI ``messages`` (assistant.tool_calls + role:"tool").
  * ``tools_to_litellm`` — the flattened livekit tools registered on the agent →
    OpenAI ``tools`` list. Our meeting tools are ALL ``RawFunctionTool`` (Composio
    actions built with ``function_tool(raw_schema=...)`` + the ``stay_silent``
    gate), so we read ``tool.info.raw_schema`` directly — matching the framework's
    own ``_provider_format/openai.py`` branch for raw tools.

Kept livekit-free and duck-typed so it is unit-testable WITHOUT the livekit extra.
"""
from __future__ import annotations

from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.native_tools")


def chat_ctx_to_oai_messages(items: list[Any], *, system: str | None = None) -> list[dict]:
    """Convert livekit ``ChatContext.items`` to OpenAI-format ``messages``.

    Handles the three item kinds we care about (duck-typed by ``.type``):
      - "message"              → {role, content}
      - "function_call"        → assistant message with tool_calls
      - "function_call_output" → {role:"tool", tool_call_id, content}
    ``call_id`` round-trips FunctionCall→FunctionCallOutput so the tool result
    matches its call. Non-text/other item types are skipped.
    """
    msgs: list[dict] = []
    if system:
        msgs.append({"role": "system", "content": system})
    for item in items:
        kind = getattr(item, "type", None)
        if kind == "message":
            role = getattr(item, "role", "user")
            if role == "developer":
                role = "system"
            text = getattr(item, "text_content", None) or ""
            if text:
                msgs.append({"role": role, "content": text})
        elif kind == "function_call":
            msgs.append(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": item.call_id,
                            "type": "function",
                            "function": {"name": item.name, "arguments": item.arguments},
                        }
                    ],
                }
            )
        elif kind == "function_call_output":
            msgs.append(
                {"role": "tool", "tool_call_id": item.call_id, "content": item.output}
            )
    return msgs


def tools_to_litellm(tools: list[Any] | None) -> list[dict]:
    """Convert the agent's flattened livekit tools to an OpenAI ``tools`` list.

    Our meeting tools are all ``RawFunctionTool`` — carrying their full schema in
    ``tool.info.raw_schema`` ({name, description, parameters}). We wrap each as
    ``{"type":"function","function": raw_schema}``. Tools without a ``raw_schema``
    (signature-based ``FunctionTool``) are skipped with a warning — none are used
    on the meeting path, so this stays livekit-free.
    """
    out: list[dict] = []
    for tool in tools or []:
        info = getattr(tool, "info", None)
        raw = getattr(info, "raw_schema", None) if info is not None else None
        if not raw:
            name = getattr(info, "name", "?") if info is not None else "?"
            _log.warning("native_tool_skipped_no_raw_schema", tool=name)
            continue
        out.append(
            {
                "type": "function",
                "function": {
                    "name": raw.get("name"),
                    "description": raw.get("description", ""),
                    "parameters": raw.get("parameters", {"type": "object", "properties": {}}),
                },
            }
        )
    return out


def accumulate_tool_call_deltas(acc: dict[int, dict], tool_call_deltas: list[Any]) -> None:
    """Fold litellm streaming tool_call deltas into ``acc`` (keyed by index).

    litellm streams a tool call across chunks: the first delta carries ``id`` +
    ``function.name``; later deltas append ``function.arguments`` fragments. We
    accumulate per ``index`` so ``finish_tool_calls`` can emit whole calls.
    """
    for tc in tool_call_deltas or []:
        idx = getattr(tc, "index", 0) or 0
        cur = acc.setdefault(idx, {"id": "", "name": "", "args": ""})
        tc_id = getattr(tc, "id", None)
        if tc_id:
            cur["id"] = tc_id
        fn = getattr(tc, "function", None)
        if fn is not None:
            if getattr(fn, "name", None):
                cur["name"] = fn.name
            if getattr(fn, "arguments", None):
                cur["args"] += fn.arguments


def finish_tool_calls(acc: dict[int, dict]) -> list[dict]:
    """Turn accumulated tool-call state into emit-ready {name, arguments, call_id}.

    ``arguments`` defaults to "{}" (valid empty JSON) if the model streamed none;
    ``call_id`` falls back to the tool name if the provider gave no id (it only
    needs to round-trip within the turn).
    """
    calls: list[dict] = []
    for cur in acc.values():
        if not cur["name"]:
            continue
        calls.append(
            {
                "name": cur["name"],
                "arguments": cur["args"] or "{}",
                "call_id": cur["id"] or f"call_{cur['name']}",
            }
        )
    return calls
