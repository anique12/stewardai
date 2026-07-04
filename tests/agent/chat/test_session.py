"""Offline tests for ChatSession: persistent-agent, interrupt-aware streaming.

Same fake-agent approach as ``test_graph.py`` (build_read_tools/make_chat_llm
run for real -- pure object construction, no network I/O -- but the LangGraph
agent itself is a scripted fake, so no real graph ever runs). The monkeypatch
target is ``graph_module.build_chat_agent`` (not a `session`-local copy of the
name): ``ChatSession`` resolves it dynamically off the live
``stewardai.agent.chat.graph`` module object at construction time, which is
also what keeps the pre-existing C1 ``test_graph.py`` monkeypatch working
after this refactor (see session.py's module docstring).
"""
from __future__ import annotations

from collections import namedtuple

from langchain_core.messages import AIMessage
from langgraph.types import Command

import stewardai.agent.chat.graph as graph_module
from stewardai.agent.chat.session import ChatSession

# Stand-in for langgraph.types.Interrupt: only `.value` is ever read.
_FakeInterrupt = namedtuple("_FakeInterrupt", ["value"])


class _FakeState:
    def __init__(self, content):
        self.values = {"messages": [AIMessage(content=content)]}


class _FakeAgent:
    def __init__(self, events, final_content="final answer"):
        self._events = events
        self._final_content = final_content
        self.astream_calls = []

    async def astream(self, inp, config, stream_mode=None):
        self.astream_calls.append((inp, config, stream_mode))
        for mode, chunk in self._events:
            yield mode, chunk

    async def aget_state(self, config):
        return _FakeState(self._final_content)


class _FakeDBClient:
    """Stand-in for the Supabase client passed to build_read_tools; unused by
    the fake agent path since tools are never invoked, just constructed."""


class _FakeEmbedLLM:
    async def aembed(self, texts, *, query=False):
        return [[0.0] * 8 for _ in texts]


def _install_fake_agent(monkeypatch, events, **kwargs) -> _FakeAgent:
    fake_agent = _FakeAgent(events, **kwargs)
    monkeypatch.setattr(graph_module, "build_chat_agent", lambda llm, tools, **kw: fake_agent)
    return fake_agent


def _make_session() -> ChatSession:
    return ChatSession(_FakeDBClient(), _FakeEmbedLLM(), user_id="u1", thread_id="thread-1")


async def _collect(gen) -> list[dict]:
    return [event async for event in gen]


async def test_stream_turn_yields_token_then_permission_request_and_stops(monkeypatch):
    events = [
        ("messages", (AIMessage(content="Sure, "), {"langgraph_node": "agent"})),
        (
            "updates",
            {
                "__interrupt__": (
                    _FakeInterrupt(value={"kind": "permission", "tool": "send_email"}),
                )
            },
        ),
    ]
    _install_fake_agent(monkeypatch, events)
    session = _make_session()

    out = await _collect(session.stream_turn("send an email to bob", []))

    assert out == [
        {"type": "token", "delta": "Sure, "},
        {
            "type": "permission_request",
            "call_id": "thread-1",
            "kind": "permission",
            "tool": "send_email",
        },
    ]
    assert not any(e["type"] == "done" for e in out)


async def test_connect_kind_interrupt_maps_to_connect_required(monkeypatch):
    events = [
        (
            "updates",
            {"__interrupt__": (_FakeInterrupt(value={"kind": "connect", "provider": "gmail"}),)},
        ),
    ]
    _install_fake_agent(monkeypatch, events)
    session = _make_session()

    out = await _collect(session.stream_turn("send an email", []))

    assert out == [
        {"type": "connect_required", "call_id": "thread-1", "kind": "connect", "provider": "gmail"}
    ]


async def test_resume_yields_token_then_done(monkeypatch):
    fake_agent = _install_fake_agent(
        monkeypatch,
        [("messages", (AIMessage(content="Done."), {"langgraph_node": "agent"}))],
        final_content="Done.",
    )
    session = _make_session()

    out = await _collect(session.resume("approve"))

    assert out == [
        {"type": "token", "delta": "Done."},
        {
            "type": "done",
            "answer": "Done.",
            "citations": [],
            "activities": [],
            "thinking": "",
            "thinking_seconds": None,
        },
    ]

    # resume() re-astreams on the SAME thread with a Command(resume=...) input.
    assert len(fake_agent.astream_calls) == 1
    inp, config, stream_mode = fake_agent.astream_calls[0]
    assert isinstance(inp, Command)
    assert inp.resume == "approve"
    assert config == {"configurable": {"thread_id": "thread-1"}}
    assert stream_mode == ["updates", "messages"]


async def test_resume_can_hit_another_interrupt(monkeypatch):
    events = [
        (
            "updates",
            {
                "__interrupt__": (
                    _FakeInterrupt(value={"kind": "permission", "tool": "archive_space"}),
                )
            },
        ),
    ]
    _install_fake_agent(monkeypatch, events)
    session = _make_session()

    out = await _collect(session.resume("approve"))

    assert out == [
        {
            "type": "permission_request",
            "call_id": "thread-1",
            "kind": "permission",
            "tool": "archive_space",
        }
    ]


async def test_clean_stream_turn_without_interrupt_ends_in_done(monkeypatch):
    events = [
        ("messages", (AIMessage(content="Hi there."), {"langgraph_node": "agent"})),
        ("updates", {"agent": {"messages": [AIMessage(content="Hi there.")]}}),
    ]
    _install_fake_agent(monkeypatch, events, final_content="Hi there.")
    session = _make_session()

    out = await _collect(session.stream_turn("hello", []))

    assert out == [
        {"type": "token", "delta": "Hi there."},
        {
            "type": "done",
            "answer": "Hi there.",
            "citations": [],
            "activities": [],
            "thinking": "",
            "thinking_seconds": None,
        },
    ]


async def test_session_reused_across_two_stream_turn_calls_same_thread(monkeypatch):
    """Sanity check for the persistence contract: one ChatSession's agent is
    built once and both calls target the same thread_id -- unlike C1's
    run_chat_turn, which minted a fresh thread (and agent) every call."""
    fake_agent = _install_fake_agent(
        monkeypatch,
        [("updates", {"agent": {"messages": [AIMessage(content="ok")]}})],
        final_content="ok",
    )
    session = _make_session()

    await _collect(session.stream_turn("first", []))
    await _collect(session.stream_turn("second", [{"role": "user", "content": "first"}]))

    assert len(fake_agent.astream_calls) == 2
    for _inp, config, _mode in fake_agent.astream_calls:
        assert config == {"configurable": {"thread_id": "thread-1"}}


async def test_stream_turn_runs_inside_chat_usage_scope(monkeypatch):
    """The turn must execute inside a usage_scope(feature="chat", ...) so the
    litellm callback can attribute every model call to this user/thread/request."""
    from stewardai.observability.usage_context import current_usage

    captured: dict = {}

    class _CapAgent(_FakeAgent):
        async def astream(self, inp, config, stream_mode=None):
            captured.update(current_usage())
            for mode, chunk in self._events:
                yield mode, chunk

    events = [("messages", (AIMessage(content="Hi"), {"langgraph_node": "agent"}))]
    agent = _CapAgent(events, final_content="Hi")
    monkeypatch.setattr(graph_module, "build_chat_agent", lambda llm, tools, **kw: agent)
    session = _make_session()

    await _collect(session.stream_turn("hello", []))

    assert captured.get("feature") == "chat"
    assert captured.get("user_id") == "u1"
    assert captured.get("thread_id") == "thread-1"
    assert captured.get("request_id")  # a uuid was assigned for this turn
