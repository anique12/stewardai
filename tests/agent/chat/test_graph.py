"""Offline tests for run_chat_turn.

``build_chat_agent`` is monkeypatched to a fake agent so no LLM call and no
real LangGraph graph ever runs -- ``build_read_tools`` (T2) and
``make_chat_llm`` (T1) still run for real inside ``run_chat_turn``, but both
are pure object construction with no network I/O. The fake agent's
``.astream`` yields a scripted sequence of ``(mode, chunk)`` items built from
real ``langchain_core.messages`` objects, mirroring the exact shapes T3's
``test_events.py`` exercises (see task-3 report), so this also verifies
``run_chat_turn`` is wired correctly to ``map_stream_event``.
"""
from __future__ import annotations

import json

from langchain_core.messages import AIMessage, ToolMessage

import stewardai.agent.chat.graph as graph_module
from stewardai.agent.chat.graph import run_chat_turn


def _tool_call(name: str, call_id: str = "call_1") -> dict:
    return {"name": name, "args": {}, "id": call_id, "type": "tool_call"}


def _kb_search_content(text: str) -> str:
    """A JSON-encoded kb_search ToolMessage.content, as it'd appear on the wire."""
    return json.dumps(
        {"passages": [{"n": 1, "text": text, "meeting_id": "m1", "source_seq": 3, "kind": "fact"}]}
    )


class _FakeState:
    def __init__(self, content):
        self.values = {"messages": [AIMessage(content=content)]}


class _FakeAgent:
    def __init__(self, events, final_content="final answer", state_raises=False):
        self._events = events
        self._final_content = final_content
        self._state_raises = state_raises
        self.astream_calls = []

    async def astream(self, inp, config, stream_mode=None):
        self.astream_calls.append((inp, config, stream_mode))
        for mode, chunk in self._events:
            yield mode, chunk

    async def aget_state(self, config):
        if self._state_raises:
            raise RuntimeError("checkpoint backend unavailable")
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


async def _collect(**kwargs):
    out = []
    async for event in run_chat_turn(
        _FakeDBClient(),
        _FakeEmbedLLM(),
        user_id="u1",
        history=kwargs.pop("history", [{"role": "user", "content": "hi earlier"}]),
        message=kwargs.pop("message", "what's up"),
    ):
        out.append(event)
    return out


SCRIPTED_EVENTS = [
    (
        "updates",
        {"agent": {"messages": [AIMessage(content="", tool_calls=[_tool_call("kb_search")])]}},
    ),
    (
        "messages",
        (
            ToolMessage(
                content=_kb_search_content("ship July 17"), name="kb_search", tool_call_id="call_1"
            ),
            {"langgraph_node": "tools"},
        ),
    ),
    (
        "updates",
        {
            "tools": {
                "messages": [
                    ToolMessage(
                        content=_kb_search_content("ship July 17"),
                        name="kb_search",
                        tool_call_id="call_1",
                    )
                ]
            }
        },
    ),
    ("messages", (AIMessage(content="The answer"), {"langgraph_node": "agent"})),
    ("messages", (AIMessage(content=" is 42."), {"langgraph_node": "agent"})),
    ("updates", {"agent": {"messages": [AIMessage(content="The answer is 42.")]}}),
]


async def test_yields_token_events_then_terminal_done(monkeypatch):
    # A cited answer references its source with an [n] marker (only referenced
    # citations are surfaced now — see session._drive's citation filter).
    fake_agent = _install_fake_agent(monkeypatch, SCRIPTED_EVENTS, final_content="final answer [1]")

    out = await _collect()

    token_events = [e for e in out if e["type"] == "token"]
    assert len(token_events) >= 1
    assert "".join(e["delta"] for e in token_events) == "The answer is 42."

    done = out[-1]
    assert done["type"] == "done"
    assert done["answer"] == "final answer [1]"
    assert done["citations"] == [
        {"n": 1, "meeting_id": "m1", "source_seq": 3, "kind": "fact", "text": "ship July 17"}
    ]
    assert isinstance(done["activities"], list)

    # ToolMessage content must never leak as a "token" event.
    assert not any("July 17" in e.get("delta", "") for e in token_events)

    # history is prepended, then the new user message appended.
    assert len(fake_agent.astream_calls) == 1
    inp, config, stream_mode = fake_agent.astream_calls[0]
    assert inp["messages"] == [
        {"role": "user", "content": "hi earlier"},
        {"role": "user", "content": "what's up"},
    ]
    assert stream_mode == ["updates", "messages"]
    assert "thread_id" in config["configurable"]


async def test_activity_events_pass_through(monkeypatch):
    _install_fake_agent(monkeypatch, SCRIPTED_EVENTS)

    out = await _collect()

    activity_events = [e for e in out if e["type"] == "activity"]
    assert {"type": "activity", "kind": "tool", "name": "kb_search", "status": "started"} in (
        activity_events
    )
    assert {"type": "activity", "kind": "tool", "name": "kb_search", "status": "done"} in (
        activity_events
    )


async def test_done_falls_back_to_accumulated_text_if_state_fetch_fails(monkeypatch):
    _install_fake_agent(monkeypatch, SCRIPTED_EVENTS, state_raises=True)

    out = await _collect()

    assert out[-1]["type"] == "done"
    assert out[-1]["answer"] == "The answer is 42."
    # The fallback answer text carries no [n] marker, so no source is surfaced
    # (citations are filtered to those the answer actually references).
    assert out[-1]["citations"] == []


async def test_citations_are_globally_numbered_and_deduped_across_kb_search_calls(monkeypatch):
    """Two kb_search calls in one turn: each call numbers its own passages
    n=1..k, which must be ignored/renumbered globally (1, 2, 3... across the
    whole turn), and a passage repeated across calls (same meeting_id +
    source_seq) must be deduped onto its first n rather than getting a new
    citation."""
    events = [
        (
            "updates",
            {
                "agent": {
                    "messages": [
                        AIMessage(content="", tool_calls=[_tool_call("kb_search", "call_1")])
                    ]
                }
            },
        ),
        (
            "updates",
            {
                "tools": {
                    "messages": [
                        ToolMessage(
                            content=json.dumps(
                                {
                                    "passages": [
                                        {
                                            "n": 1,
                                            "meeting_id": "m1",
                                            "source_seq": 3,
                                            "kind": "fact",
                                            "text": "ship July 17",
                                        }
                                    ]
                                }
                            ),
                            name="kb_search",
                            tool_call_id="call_1",
                        )
                    ]
                }
            },
        ),
        (
            "updates",
            {
                "agent": {
                    "messages": [
                        AIMessage(content="", tool_calls=[_tool_call("kb_search", "call_2")])
                    ]
                }
            },
        ),
        (
            "updates",
            {
                "tools": {
                    "messages": [
                        ToolMessage(
                            content=json.dumps(
                                {
                                    "passages": [
                                        {
                                            # Same passage as call_1 -- kb_search's own
                                            # per-call n=1 here must NOT collide with /
                                            # overwrite the earlier citation's n=1.
                                            "n": 1,
                                            "meeting_id": "m1",
                                            "source_seq": 3,
                                            "kind": "fact",
                                            "text": "ship July 17 (again)",
                                        },
                                        {
                                            "n": 2,
                                            "meeting_id": "m2",
                                            "source_seq": 7,
                                            "kind": "fact",
                                            "text": "launch Aug 1",
                                        },
                                    ]
                                }
                            ),
                            name="kb_search",
                            tool_call_id="call_2",
                        )
                    ]
                }
            },
        ),
    ]
    _install_fake_agent(monkeypatch, events, final_content="Answer with [1][2].")

    out = await _collect()

    assert out[-1]["type"] == "done"
    assert out[-1]["citations"] == [
        {"n": 1, "meeting_id": "m1", "source_seq": 3, "kind": "fact", "text": "ship July 17"},
        {"n": 2, "meeting_id": "m2", "source_seq": 7, "kind": "fact", "text": "launch Aug 1"},
    ]


async def test_citations_trust_kb_search_turn_global_numbering_across_two_calls(monkeypatch):
    """Regression for the citation-mismatch bug: kb_search must assign
    turn-global (not per-call) numbers via a shared cite_registry, and
    _collect_citations must trust those numbers as-is (not independently
    reassign len(citations)+1) so the [n] the model saw from kb_search is
    exactly the [n] resolved in the stored citations. Simulates a turn with
    TWO kb_search calls: call 1 returns 2 passages from meeting A; call 2
    repeats meeting A's first passage and adds one new passage from meeting
    B."""
    import stewardai.agent.chat.tools as T
    from stewardai.agent.chat.tools import CiteRegistry, build_read_tools

    class _FakeDBClient2:
        pass

    class _FakeEmbedLLM2:
        async def aembed(self, texts, *, query=False):
            return [[0.0] * 8 for _ in texts]

    call_rows = [
        [
            {"text": "ship July 17", "meeting_id": "m1", "source_seq": 3, "kind": "fact"},
            {"text": "budget approved", "meeting_id": "m1", "source_seq": 4, "kind": "fact"},
        ],
        [
            {"text": "ship July 17 (again)", "meeting_id": "m1", "source_seq": 3, "kind": "fact"},
            {"text": "launch Aug 1", "meeting_id": "m2", "source_seq": 7, "kind": "fact"},
        ],
    ]

    async def fake_retrieve(client, llm, *, user_id, query, space_id=None, k=8):
        return call_rows.pop(0)

    monkeypatch.setattr(T, "retrieve", fake_retrieve)
    registry = CiteRegistry()
    tools = build_read_tools(
        _FakeDBClient2(), _FakeEmbedLLM2(), user_id="u1", cite_registry=registry
    )
    kb = next(t for t in tools if t.name == "kb_search")

    kb_out_1 = await kb.ainvoke({"query": "first"})
    kb_out_2 = await kb.ainvoke({"query": "second"})

    events = [
        (
            "updates",
            {
                "agent": {
                    "messages": [
                        AIMessage(content="", tool_calls=[_tool_call("kb_search", "call_1")])
                    ]
                }
            },
        ),
        (
            "updates",
            {
                "tools": {
                    "messages": [
                        ToolMessage(
                            content=json.dumps(kb_out_1),
                            name="kb_search",
                            tool_call_id="call_1",
                        )
                    ]
                }
            },
        ),
        (
            "updates",
            {
                "agent": {
                    "messages": [
                        AIMessage(content="", tool_calls=[_tool_call("kb_search", "call_2")])
                    ]
                }
            },
        ),
        (
            "updates",
            {
                "tools": {
                    "messages": [
                        ToolMessage(
                            content=json.dumps(kb_out_2),
                            name="kb_search",
                            tool_call_id="call_2",
                        )
                    ]
                }
            },
        ),
    ]
    _install_fake_agent(monkeypatch, events, final_content="Answer with [1][2][3].")

    out = await _collect()

    done = out[-1]
    assert done["type"] == "done"
    citations_by_key = {(c["meeting_id"], c["source_seq"]): c["n"] for c in done["citations"]}
    assert citations_by_key == {("m1", 3): 1, ("m1", 4): 2, ("m2", 7): 3}

    # What kb_search told the model must equal what got stored -- the whole
    # point of the fix: the model's [n] and the stored citation n must agree.
    assert kb_out_1["passages"][0]["n"] == citations_by_key[("m1", 3)]
    assert kb_out_1["passages"][1]["n"] == citations_by_key[("m1", 4)]
    assert kb_out_2["passages"][0]["n"] == citations_by_key[("m1", 3)]
    assert kb_out_2["passages"][1]["n"] == citations_by_key[("m2", 7)]


async def test_no_tool_calls_yields_no_citations(monkeypatch):
    events = [
        ("messages", (AIMessage(content="Hi there."), {"langgraph_node": "agent"})),
        ("updates", {"agent": {"messages": [AIMessage(content="Hi there.")]}}),
    ]
    _install_fake_agent(monkeypatch, events, final_content="Hi there.")

    out = await _collect()

    assert out[-1] == {
        "type": "done",
        "answer": "Hi there.",
        "citations": [],
        "activities": [],
        "thinking": "",
        "thinking_seconds": None,
    }
