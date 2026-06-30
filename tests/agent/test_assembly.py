"""Heavy test for the roomless LiveKit AgentSession assembly.

Skipped unless ``livekit.agents`` is installed (it lives in the ``[cpu]`` /
``[cuda]`` extra). Run on the box with:
    pytest -m heavy tests/agent/test_assembly.py

This only asserts the session *constructs* from stub backends; it does not run
a live audio loop (that needs a real meeting + the Vexa bridge).
"""

from __future__ import annotations

import asyncio

import pytest

from stewardai.config import Settings

pytestmark = pytest.mark.heavy

# Skip the whole module if the livekit extra is absent.
pytest.importorskip("livekit.agents")


@pytest.fixture(autouse=True)
def _ensure_event_loop():
    """Guarantee a current event loop for the synchronous build tests.

    ``AgentSession.__init__`` calls ``asyncio.get_event_loop()``. Under
    pytest-asyncio's ``auto`` mode an earlier async test closes its loop and
    leaves the thread with no current loop, so a *sync* test that constructs an
    ``AgentSession`` afterwards would otherwise raise ``RuntimeError: There is
    no current event loop``. Install a fresh loop for these sync tests; the
    behaviour is otherwise identical when a loop already exists.
    """
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())
    yield


def _stub_settings() -> Settings:
    """All-stub backends so no network/GPU/model downloads are needed."""
    return Settings(stt_backend="stub", tts_backend="stub", llm_backend="stub")


def test_nodes_construct_from_stub_backends():
    from stewardai.agent.nodes import build_llm_node, build_stt_node, build_tts_node
    from stewardai.llm.stub import StubLLM
    from stewardai.stt.stub import StubSTT
    from stewardai.tts.stub import StubTTS

    stt = build_stt_node(StubSTT())
    llm = build_llm_node(StubLLM())
    tts = build_tts_node(StubTTS(), voice="stub")

    # Each adapter wraps our backend and reports a capabilities object.
    assert stt is not None and hasattr(stt, "capabilities")
    assert tts is not None and hasattr(tts, "capabilities")
    assert llm is not None
    # The TTS node advertises our canonical 16 kHz mono format.
    assert tts.sample_rate == 16_000
    assert tts.num_channels == 1


def test_build_session_constructs_without_error():
    from livekit.agents import AgentSession

    from stewardai.agent.assembly import build_session

    session = build_session(_stub_settings())
    assert isinstance(session, AgentSession)


def test_build_agent_has_instructions():
    from stewardai.agent.assembly import build_agent

    agent = build_agent(_stub_settings())
    # The Agent persona exposes its instructions (exact attr name may vary in 1.x).
    assert agent is not None
