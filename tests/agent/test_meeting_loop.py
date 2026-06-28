"""Unit and integration tests for the meeting runner's paced-send pump.

Light tests (no livekit): TcpFrameServer + QueueAudioOutput + AudioFrame.
Heavy tests (require livekit): full component-wired e2e through the gated
decision path — fake bot receives PCM iff StubLLM says speak.
"""

from __future__ import annotations

import asyncio
import struct

import pytest

from stewardai.agent.meeting_runner import _pump_paced
from stewardai.bridge.audio_output import QueueAudioOutput
from stewardai.bridge.transport import TcpFrameServer
from stewardai.common.audio import AudioFrame

_LEN = struct.Struct(">I")


async def _wait_connected(server, timeout=2.0):
    async def _poll():
        while server._source_writer is None:
            await asyncio.sleep(0.01)
    await asyncio.wait_for(_poll(), timeout)


@pytest.mark.asyncio
async def test_pump_sends_paced_frames_to_server():
    server = TcpFrameServer(host="127.0.0.1", port=0)
    await server.start()
    out = QueueAudioOutput(label="test")
    pcm = b"\x00\x00" * 12000  # 0.5s @ 24kHz s16le
    await out.capture_frame(AudioFrame(pcm=pcm, sample_rate=24000))
    out.flush()
    await out.aclose()

    # Connect a raw TCP client that will READ back what the server sends
    reader, writer = await asyncio.open_connection("127.0.0.1", server.port)

    # Wait for server to register our connection before pumping
    await _wait_connected(server)

    await asyncio.wait_for(_pump_paced(out, server), timeout=5)

    # Read length-prefixed frames back on the client side
    got = b""
    while True:
        try:
            header = await asyncio.wait_for(reader.readexactly(4), timeout=1.0)
            (n,) = _LEN.unpack(header)
            payload = await asyncio.wait_for(reader.readexactly(n), timeout=1.0)
            got += payload
        except (TimeoutError, asyncio.IncompleteReadError):
            break

    writer.close()
    await writer.wait_closed()
    await server.aclose()

    assert got == pcm


# ---------------------------------------------------------------------------
# Heavy e2e test — requires livekit.agents
# ---------------------------------------------------------------------------
# NOTE: the livekit guard lives INSIDE the heavy test (not at module scope) so a
# no-livekit base install can still import this module and run the light
# `test_pump_sends_paced_frames_to_server` above — its imports are all
# livekit-free.


@pytest.mark.heavy
@pytest.mark.asyncio
async def test_meeting_loop_silent_then_speaks():
    """Gated decision controls whether PCM flows to the bot over the real socket.

    Uses StubLLM (next_decision) + StubTTS — no models or network needed.
    Approach: component-wired e2e (fallback).  We drive the gated LLM node and
    StubTTS directly rather than through a live AgentSession+VAD because making
    Silero VAD fire reliably on synthetic audio is non-deterministic and out of
    scope for this test.  The load-bearing novel behaviour — gated decide controls
    whether PCM flows over the socket — is fully exercised.

    Phase 1 (silent): StubLLM.next_decision = Decision(speak=False)
        -> QueueAudioOutput receives nothing -> FakeBot.received is empty.
    Phase 2 (speak):  StubLLM.next_decision = Decision(speak=True, text="Hi!")
        -> StubTTS synthesizes PCM -> _pump_paced streams it -> FakeBot.received > 0.
    """
    pytest.importorskip("livekit")
    import importlib.util
    import pathlib
    _fb_path = pathlib.Path(__file__).parent / "fake_bot.py"
    _spec = importlib.util.spec_from_file_location("fake_bot", _fb_path)
    _mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
    _spec.loader.exec_module(_mod)  # type: ignore[union-attr]
    FakeBot = _mod.FakeBot
    from livekit.agents import llm as lk_llm  # noqa: F401 – ensures extra present

    from stewardai.agent.nodes import build_llm_node
    from stewardai.bridge.audio_output import QueueAudioOutput
    from stewardai.bridge.transport import TcpFrameServer
    from stewardai.common.audio import Decision
    from stewardai.llm.stub import StubLLM
    from stewardai.tts.stub import StubTTS

    # ------------------------------------------------------------------ setup
    stub_llm = StubLLM()
    stub_tts = StubTTS()
    llm_node = build_llm_node(stub_llm, gated=True)

    # Agent-side frame server (bot connects to this)
    server = TcpFrameServer(host="127.0.0.1", port=0)
    await server.start()

    bot = FakeBot()
    await bot.connect("127.0.0.1", server.port)
    await _wait_connected(server, timeout=2.0)

    # ------------------------------------------------------------------ helpers
    async def _run_gated_phase(text: str) -> bool:
        """Drive one gated-LLM turn; if speak, push frames into out. Return speak."""
        ctx = lk_llm.ChatContext.empty()
        ctx.add_message(role="user", content=text)
        stream = llm_node.chat(chat_ctx=ctx)
        chunks = []
        async for chunk in stream:
            delta = getattr(getattr(chunk, "delta", None), "content", None)
            if delta:
                chunks.append(delta)
        return bool(chunks)  # True iff the node emitted any deltas

    async def _synthesize_to_output(out: QueueAudioOutput, text: str) -> bytes:
        """Synthesize text via StubTTS, capture all PCM, push into out; return PCM."""
        all_pcm = bytearray()
        async for frame in stub_tts.synthesize(text):
            await out.capture_frame(frame)
            all_pcm += frame.pcm
        out.flush()
        await out.aclose()
        return bytes(all_pcm)

    # ================================================================== Phase 1: silent
    stub_llm.next_decision = Decision(speak=False)
    spoke = await _run_gated_phase("background noise nobody cares about")
    assert not spoke, "gated node should emit nothing when speak=False"

    # No TTS → output queue is empty; pump completes immediately (queue closed).
    out1 = QueueAudioOutput(label="phase1")
    await out1.aclose()  # close immediately — nothing enqueued
    pump1 = asyncio.create_task(_pump_paced(out1, server))
    await asyncio.wait_for(pump1, timeout=2.0)

    # Sequencing matters: _pump_paced is awaited to COMPLETION above, so if it
    # had (wrongly) sent any bytes they are already in the TCP buffer by now.
    # read_for then DRAINS that buffer and the == 0 check catches the regression.
    # The 0.3s window is just a drain margin, not a wait for anything in-flight —
    # do NOT reorder read_for before the pump's completion or this becomes a race.
    await bot.read_for(seconds=0.3)
    assert len(bot.received) == 0, (
        f"Silent phase: expected 0 bytes, got {len(bot.received)}"
    )

    # ================================================================== Phase 2: speak
    stub_llm.next_decision = Decision(speak=True, text="Hi! This is a test reply.")
    spoke = await _run_gated_phase("hey stewardai, say something")
    assert spoke, "gated node should emit text when speak=True"

    out2 = QueueAudioOutput(label="phase2")
    expected_pcm = await _synthesize_to_output(out2, "Hi! This is a test reply.")

    pump2 = asyncio.create_task(_pump_paced(out2, server))
    # read_for timeout must cover the paced playback duration (StubTTS ~0.5-2s)
    await bot.read_for(seconds=5.0)
    await asyncio.wait_for(pump2, timeout=5.0)

    assert len(bot.received) > 0, (
        "Speak phase: expected PCM bytes on bot, got 0"
    )
    assert bot.received == bytearray(expected_pcm), (
        f"Received PCM mismatch: got {len(bot.received)} bytes, "
        f"expected {len(expected_pcm)} bytes"
    )

    # ------------------------------------------------------------------ teardown
    await bot.aclose()
    await server.aclose()
