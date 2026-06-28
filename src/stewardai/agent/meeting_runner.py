"""Topology-A meeting runner: AgentSession <-> Vexa bot over sockets + Redis.

Inbound meeting PCM arrives on a TcpFrameServer (the bot connects and tees audio).
Agent TTS streams back out, paced, over the SAME connection via server.send().
Barge-in (clear_buffer) fires mic_off + speak_stop over Redis. The LLM node runs
GATED (decide per utterance). livekit imports stay lazy.
"""
from __future__ import annotations

import asyncio
import contextlib

from stewardai.bridge.transport import TcpFrameServer
from stewardai.bridge.vexa_control import RedisControl
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("agent.meeting_runner")


async def _pump_paced(audio_out, server: TcpFrameServer) -> None:  # noqa: ANN001
    """Drain the paced output and stream each frame to the bot at ~real time.

    Sends each AudioFrame's PCM via the server's send() method, which writes
    length-prefixed bytes back to the connected source client (full-duplex on
    the same TCP connection that delivers inbound meeting audio).

    Pacing is self-determined by each frame's own sample_rate.
    """
    async for frame in audio_out.paced_frames():
        await server.send(frame.pcm)


async def _feed_inbound(server: TcpFrameServer, audio_in) -> None:  # noqa: ANN001
    """Forward inbound socket frames into the LiveKit PushAudioInput."""
    async for pcm in server.frames():
        audio_in.push(pcm)
    with contextlib.suppress(Exception):
        audio_in.end_input()


async def run_meeting(settings: Settings | None = None) -> None:
    """Run the meeting voice agent, wired to the Vexa bot over a single TCP connection.

    The TcpFrameServer listens for the bot to connect and tee its meeting audio
    inbound; the agent's TTS output is sent back over the same connection via
    server.send(). Barge-in fires mic_off + speak_stop over Redis.
    """
    s = settings or get_settings()
    from livekit.agents import AgentSession  # noqa: F401  (ensures extra present)

    from stewardai.agent.assembly import build_agent, build_session
    from stewardai.bridge.audio_input import _build_push_audio_input
    from stewardai.bridge.audio_output import QueueAudioOutput

    server = TcpFrameServer(s.bridge_tcp_host, s.bridge_tcp_port)
    await server.start()
    control = RedisControl(s.redis_url, s.vexa_meeting_id or "unknown")
    session = build_session(s, stt_backend=None, llm_backend=None, tts_backend=None, gated=True)
    agent = build_agent(s)
    audio_in = _build_push_audio_input()()
    audio_out = QueueAudioOutput(label="vexa")
    session.input.audio = audio_in
    session.output.audio = audio_out
    loop = asyncio.get_running_loop()

    def _on_clear() -> None:
        loop.create_task(control.mic_off())
        loop.create_task(control.speak_stop())

    audio_out.on_clear = _on_clear

    # Per-utterance mic gating: unmute right before the first frame of each
    # TTS segment is sent, mute again once the segment sentinel is processed.
    # Note: mic_on is async scheduled via create_task, so the very first frame
    # may be sent ~1 event-loop tick before the mic is fully open — acceptable
    # for v1 (tens-of-ms onset clip is inaudible in practice).
    audio_out.on_segment_start = lambda: loop.create_task(control.mic_on())
    audio_out.on_segment_end = lambda: loop.create_task(control.mic_off())

    await session.start(agent=agent)
    pump = asyncio.create_task(_pump_paced(audio_out, server))
    feed = asyncio.create_task(_feed_inbound(server, audio_in))
    _log.info("meeting_agent_started", meeting=s.vexa_meeting_id)
    try:
        await asyncio.Event().wait()
    finally:
        for t in (pump, feed):
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t
        with contextlib.suppress(Exception):
            await session.aclose()
        with contextlib.suppress(Exception):
            await control.mic_off()
        with contextlib.suppress(Exception):
            await control.aclose()
        with contextlib.suppress(Exception):
            await server.aclose()


def _main() -> None:
    """CLI entrypoint: run the meeting agent until interrupted (Ctrl-C).

    All config comes from env / .env: VEXA_MEETING_ID (must match the bot's
    Redis command-channel meeting id), STT_BACKEND / TTS_BACKEND, GEMINI_API_KEY,
    BRIDGE_TCP_HOST / BRIDGE_TCP_PORT (the bot's forwarder connects here), REDIS_URL.
    The agent listens on BRIDGE_TCP_PORT for the patched Vexa bot to connect, then
    listens to the meeting, decides per utterance, and speaks back when addressed.
    """
    from stewardai.common.logging import configure_logging

    s = get_settings()
    configure_logging(level=s.log_level, fmt=s.log_format)
    if not s.vexa_meeting_id:
        _log.warning(
            "vexa_meeting_id_unset",
            note="set VEXA_MEETING_ID so mic/stop commands target the right bot",
        )
    _log.info(
        "meeting_agent_boot",
        meeting=s.vexa_meeting_id,
        listen=f"{s.bridge_tcp_host}:{s.bridge_tcp_port}",
        stt=s.stt_backend,
        tts=s.tts_backend,
    )
    try:
        asyncio.run(run_meeting(s))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    _main()
