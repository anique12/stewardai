"""native_tools — pure OpenAI-format conversions for the native meeting path."""

from __future__ import annotations

from dataclasses import dataclass, field

from stewardai.agent.native_tools import (
    accumulate_tool_call_deltas,
    chat_ctx_to_oai_messages,
    finish_tool_calls,
    tools_to_litellm,
)


# --- duck-typed stand-ins for livekit chat items / tools --------------------------


@dataclass
class _Msg:
    role: str
    text_content: str
    type: str = "message"


@dataclass
class _Call:
    call_id: str
    name: str
    arguments: str
    type: str = "function_call"


@dataclass
class _Out:
    call_id: str
    output: str
    type: str = "function_call_output"


@dataclass
class _Info:
    name: str
    raw_schema: dict | None


@dataclass
class _Tool:
    info: _Info


# --- chat_ctx_to_oai_messages ----------------------------------------------------


def test_messages_prepends_system_and_maps_roles():
    items = [_Msg("user", "[Anique]: hi"), _Msg("assistant", "hello")]
    out = chat_ctx_to_oai_messages(items, system="SYS")
    assert out[0] == {"role": "system", "content": "SYS"}
    assert out[1] == {"role": "user", "content": "[Anique]: hi"}
    assert out[2] == {"role": "assistant", "content": "hello"}


def test_developer_role_becomes_system_and_empty_text_skipped():
    out = chat_ctx_to_oai_messages([_Msg("developer", "note"), _Msg("user", "")])
    assert out == [{"role": "system", "content": "note"}]


def test_function_call_and_output_roundtrip_to_openai_tool_messages():
    items = [
        _Call(call_id="c1", name="GOOGLECALENDAR_CREATE_EVENT", arguments='{"x":1}'),
        _Out(call_id="c1", output='{"ok":true}'),
    ]
    out = chat_ctx_to_oai_messages(items)
    assert out[0] == {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "c1",
                "type": "function",
                "function": {"name": "GOOGLECALENDAR_CREATE_EVENT", "arguments": '{"x":1}'},
            }
        ],
    }
    assert out[1] == {"role": "tool", "tool_call_id": "c1", "content": '{"ok":true}'}


# --- tools_to_litellm ------------------------------------------------------------


def test_raw_tool_wrapped_as_openai_function():
    params = {"type": "object", "properties": {"q": {"type": "string"}}}
    tool = _Tool(_Info("SLACK_SEARCH", {"name": "SLACK_SEARCH", "description": "d", "parameters": params}))
    out = tools_to_litellm([tool])
    assert out == [
        {"type": "function", "function": {"name": "SLACK_SEARCH", "description": "d", "parameters": params}}
    ]


def test_tool_without_raw_schema_is_skipped():
    assert tools_to_litellm([_Tool(_Info("sig_based", None))]) == []
    assert tools_to_litellm(None) == []


# --- streaming tool-call accumulation --------------------------------------------


@dataclass
class _Fn:
    name: str | None = None
    arguments: str | None = None


@dataclass
class _TCDelta:
    index: int = 0
    id: str | None = None
    function: _Fn = field(default_factory=_Fn)


def test_accumulate_then_finish_builds_whole_call():
    acc: dict[int, dict] = {}
    accumulate_tool_call_deltas(acc, [_TCDelta(0, "call_abc", _Fn(name="CREATE", arguments='{"a":'))])
    accumulate_tool_call_deltas(acc, [_TCDelta(0, None, _Fn(arguments='1}'))])
    calls = finish_tool_calls(acc)
    assert calls == [{"name": "CREATE", "arguments": '{"a":1}', "call_id": "call_abc"}]


def test_finish_defaults_empty_args_and_synthesizes_call_id():
    acc: dict[int, dict] = {}
    accumulate_tool_call_deltas(acc, [_TCDelta(0, None, _Fn(name="stay_silent"))])
    calls = finish_tool_calls(acc)
    assert calls == [{"name": "stay_silent", "arguments": "{}", "call_id": "call_stay_silent"}]


def test_finish_ignores_indices_without_a_name():
    acc: dict[int, dict] = {0: {"id": "x", "name": "", "args": "{}"}}
    assert finish_tool_calls(acc) == []
