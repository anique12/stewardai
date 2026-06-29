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
    from livekit.agents import metrics as lk_metrics  # per-turn timing breakdown
    from livekit.agents.utils import http_context  # http session for cloud plugins

    from stewardai.agent.assembly import build_meeting_agent, build_session
    from stewardai.agent.summary import generate_summary, write_summary
    from stewardai.bridge.audio_input import _build_push_audio_input
    from stewardai.bridge.audio_output import QueueAudioOutput
    from stewardai.bridge.speaker_events import SpeakerSubscriber, SpeakerTracker
    from stewardai.factory import make_llm
    from stewardai.llm.warmup import warmup_llm

    server = TcpFrameServer(s.bridge_tcp_host, s.bridge_tcp_port)
    await server.start()
    control = RedisControl(s.redis_url, s.vexa_meeting_id or "unknown")
    tracker = SpeakerTracker()
    transcript: list[str] = []
    # Build the LLM backend explicitly so we can warm its connection before the first
    # turn (the first Gemini call is ~5.8s cold vs ~0.56s warm — see llm.warmup).
    llm_backend = make_llm(s)
    # decide() needs the committed turn, not partials -> force preemptive off when gated.
    session = build_session(
        s, stt_backend=None, llm_backend=llm_backend, tts_backend=None, gated=True
    )
    agent = build_meeting_agent(s, tracker=tracker, transcript=transcript)
    audio_in = _build_push_audio_input()()
    audio_out = QueueAudioOutput(label="vexa")
    session.input.audio = audio_in
    session.output.audio = audio_out
    loop = asyncio.get_running_loop()

    def _on_clear() -> None:
        # Barge-in: just stop the agent's current speech. The mic stays ON (see below),
        # so no mic_off here — muting on barge-in is unnecessary and only adds thrash.
        loop.create_task(control.speak_stop())

    audio_out.on_clear = _on_clear

    # Mic stays ON for the whole session (no per-utterance gating). The previous
    # mic_on@segment-start / mic_off@segment-end logic raced Google Meet's unmute
    # latency and muted the bot WHILE the agent was still speaking (multi-segment
    # replies clipped). The agent only feeds the bot TTS audio when it actually speaks,
    # so an always-on mic transmits speech when present and silence otherwise — gating
    # buys nothing. mic_on is published once, after session.start, below.
    # (on_segment_start/on_segment_end intentionally left unset.)

    # Per-turn timing breakdown (LiveKit's OWN measurements) -> logs, so the meeting
    # path is observable like /pipeline (which streams these to the browser). Shows
    # WHERE a slow turn goes: endpointing (eou_delay) vs STT vs LLM (ttft) vs TTS (ttfb).
    # If these sum to far less than the felt latency, the rest is the Vexa transport +
    # mic-unmute path (tap -> TCP -> agent, and TTS -> TCP -> bot -> PulseAudio -> Meet).
    def _ms(x):  # noqa: ANN001, ANN202 - seconds float | None -> ms int | None
        return round(x * 1000) if x is not None else None

    def _log_metrics(ev) -> None:  # noqa: ANN001 - MetricsCollectedEvent
        m = ev.metrics
        if isinstance(m, lk_metrics.EOUMetrics):
            _log.info("turn_eou", eou_delay_ms=_ms(m.end_of_utterance_delay),
                      transcription_delay_ms=_ms(m.transcription_delay))
        elif isinstance(m, lk_metrics.STTMetrics):
            _log.info("turn_stt", duration_ms=_ms(m.duration))
        elif isinstance(m, lk_metrics.LLMMetrics):
            _log.info("turn_llm", ttft_ms=_ms(m.ttft), duration_ms=_ms(m.duration))
        elif isinstance(m, lk_metrics.TTSMetrics):
            _log.info("turn_tts", ttfb_ms=_ms(m.ttfb), duration_ms=_ms(m.duration))

    session.on("metrics_collected", _log_metrics)

    # Warm the LLM connection BEFORE we start listening, so the first real turn doesn't
    # pay the ~5s cold-connection cost (measured ~5.8s cold vs ~0.56s warm).
    await warmup_llm(llm_backend)

    # Cloud STT/TTS plugins (deepgram/cartesia) need an http session context, which
    # only exists inside a LiveKit job; roomless we open one explicitly. Harmless for
    # the local backends (they don't use it).
    async with http_context.open():
        await session.start(agent=agent)
        speaker_sub = SpeakerSubscriber(s.redis_url, s.vexa_meeting_id or "unknown", tracker)
        with contextlib.suppress(Exception):
            await speaker_sub.start()
        # Unmute the bot once and leave it on for the session (the bot subscribes to its
        # Redis command channel at startup, so this reaches it; it already connected the
        # audio bridge by now — client_connected precedes session.start completing).
        with contextlib.suppress(Exception):
            await control.mic_on()
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
                summary = await asyncio.wait_for(
                    generate_summary(llm_backend, transcript), timeout=10.0
                )
                write_summary(s.vexa_meeting_id or "unknown", summary)
            with contextlib.suppress(Exception):
                await session.aclose()
            with contextlib.suppress(Exception):
                await control.mic_off()
            with contextlib.suppress(Exception):
                await control.aclose()
            with contextlib.suppress(Exception):
                await speaker_sub.aclose()
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
