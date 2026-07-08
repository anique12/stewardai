"""Tests for map_stream_event against the real (lightweight) langchain_core
message classes, mirroring the exact shapes observed from
create_react_agent(...).astream(..., stream_mode=["updates", "messages"])
against ChatLiteLLM(gemini/gemini-2.5-flash) -- see task-3 report. No network
calls: these are plain in-memory message objects, not a live agent run.
"""
from __future__ import annotations

from langchain_core.messages import AIMessage, ToolMessage

from stewardai.agent.chat.events import map_stream_event


def _tool_call(name: str, call_id: str = "call_1") -> dict:
    return {"name": name, "args": {}, "id": call_id, "type": "tool_call"}


class TestMessagesMode:
    def test_text_chunk_becomes_token_event(self):
        meta = {"langgraph_node": "agent"}
        chunk = (AIMessage(content="Hello"), meta)

        assert map_stream_event("messages", chunk) == [{"type": "token", "delta": "Hello"}]

    def test_tool_call_only_chunk_has_empty_content_and_is_skipped(self):
        msg = AIMessage(content="", tool_calls=[_tool_call("kb_search")])
        chunk = (msg, {"langgraph_node": "agent"})

        assert map_stream_event("messages", chunk) == []

    def test_tool_message_content_is_not_surfaced_as_a_token(self):
        # ToolMessage.content is the tool's *output*, not assistant prose --
        # emitting it as a "token" would leak tool results into the answer.
        msg = ToolMessage(content="2026-07-17", name="kb_search", tool_call_id="call_1")
        chunk = (msg, {"langgraph_node": "tools"})

        assert map_stream_event("messages", chunk) == []

    def test_malformed_messages_chunk_returns_empty_list(self):
        assert map_stream_event("messages", "not-a-tuple") == []
        assert map_stream_event("messages", (AIMessage(content="hi"),)) == []


class TestUpdatesMode:
    def test_tools_node_tool_message_becomes_done_activity(self):
        chunk = {
            "tools": {
                "messages": [
                    ToolMessage(content="2026-07-17", name="kb_search", tool_call_id="call_1")
                ]
            }
        }

        assert map_stream_event("updates", chunk) == [
            {"type": "activity", "kind": "tool", "name": "kb_search", "status": "done"}
        ]

    def test_agent_node_ai_message_with_tool_calls_becomes_started_activity(self):
        chunk = {
            "agent": {
                "messages": [AIMessage(content="", tool_calls=[_tool_call("kb_search")])]
            }
        }

        assert map_stream_event("updates", chunk) == [
            {"type": "activity", "kind": "tool", "name": "kb_search", "status": "started"}
        ]

    def test_agent_node_ai_message_with_multiple_tool_calls_emits_one_each(self):
        chunk = {
            "agent": {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            _tool_call("kb_search", "call_1"),
                            _tool_call("list_spaces", "call_2"),
                        ],
                    )
                ]
            }
        }

        assert map_stream_event("updates", chunk) == [
            {"type": "activity", "kind": "tool", "name": "kb_search", "status": "started"},
            {"type": "activity", "kind": "tool", "name": "list_spaces", "status": "started"},
        ]

    def test_agent_node_final_answer_with_no_tool_calls_yields_no_activity(self):
        chunk = {"agent": {"messages": [AIMessage(content="The answer is 42.")]}}

        assert map_stream_event("updates", chunk) == []

    def test_malformed_updates_chunk_returns_empty_list(self):
        assert map_stream_event("updates", None) == []
        assert map_stream_event("updates", {"agent": "not-a-dict"}) == []
        assert map_stream_event("updates", {"agent": {"messages": "not-a-list"}}) == []


class TestUnrecognized:
    def test_unknown_mode_returns_empty_list(self):
        assert map_stream_event("values", {"messages": []}) == []
        assert map_stream_event("debug", object()) == []

    def test_never_raises_on_garbage_input(self):
        assert map_stream_event("messages", None) == []
        assert map_stream_event("updates", 12345) == []
