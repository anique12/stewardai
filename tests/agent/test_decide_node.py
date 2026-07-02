"""Heavy tests: gated LLM node emits no speech when decide says silent.

Skipped unless livekit.agents is installed. Run with:
    pytest -m heavy tests/agent/test_decide_node.py
"""

from __future__ import annotations

import pytest

pytest.importorskip("livekit")
pytestmark = pytest.mark.heavy

from stewardai.agent.nodes import build_llm_node  # noqa: E402
from stewardai.common.audio import Decision  # noqa: E402
from stewardai.llm.stub import StubLLM  # noqa: E402


async def _collect_text(stream) -> str:
    """Drain an LLMStream and return all concatenated content deltas."""
    out = []
    async for chunk in stream:
        delta = getattr(getattr(chunk, "delta", None), "content", None)
        if delta:
            out.append(delta)
    return "".join(out)


@pytest.mark.asyncio
async def test_gated_node_silent_emits_nothing(make_chat_ctx):
    """When decide() returns speak=False, the gated stream yields zero deltas."""
    llm = StubLLM()
    llm.next_decision = Decision(speak=False)
    node = build_llm_node(llm, gated=True)
    text = await _collect_text(node.chat(chat_ctx=make_chat_ctx("blah blah")))
    assert text == ""


@pytest.mark.asyncio
async def test_gated_node_speaks_when_decided(make_chat_ctx):
    """When decide() returns speak=True with text, the stream yields exactly that text."""
    llm = StubLLM()
    llm.next_decision = Decision(speak=True, text="Sure.")
    node = build_llm_node(llm, gated=True)
    text = await _collect_text(node.chat(chat_ctx=make_chat_ctx("hey stewardai")))
    assert text == "Sure."


@pytest.mark.asyncio
async def test_gated_node_swallows_decide_failure(make_chat_ctx):
    """A failing decide() (e.g. a transient Gemini connection Timeout) must NOT
    propagate out of the node: the stream yields nothing so the turn completes and
    the AgentSession never wedges ("speech scheduling is paused" -> frozen transcript)."""

    class _BoomLLM(StubLLM):
        async def decide_stream(self, messages, *, system=None, action_tools=None):  # noqa: ANN001
            raise TimeoutError("Connection timed out")
            yield  # pragma: no cover — makes this an async generator that raises

    node = build_llm_node(_BoomLLM(), gated=True)
    # Must not raise; must yield no speech.
    text = await _collect_text(node.chat(chat_ctx=make_chat_ctx("hey stewardai")))
    assert text == ""
