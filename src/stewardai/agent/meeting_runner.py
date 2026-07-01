"""Topology-A meeting runner: N concurrent AgentSessions <-> N Vexa bots.

The agent is a MULTIPLEXER. ONE process listens on ONE port; each Vexa bot dials
in over the type-tagged transport (see ``bridge/transport``), sends a handshake
(``meeting_id`` + ``native_meeting_id``), and gets its OWN independent
``MeetingSession`` — its own AgentSession, PushAudioInput, QueueAudioOutput, Redis
control channel, speaker subscriber, and pump tasks.

Heavy, expensive-to-build objects are PROCESS-GLOBAL, constructed ONCE and shared
across every session: the STT/LLM/TTS backends (models load once), the LLM warmup
+ keepalive, the ``http_context`` scope for cloud plugins, the ComposioService,
and the Supabase service client. Per-connection code touches none of those beyond
reading them.

Inbound meeting PCM arrives as ``0x00`` frames on a bot's connection; agent TTS
streams back out, paced, as ``0x00`` frames on the SAME connection. Barge-in
(clear_buffer) fires speak_stop over Redis. The LLM node runs GATED (decide per
utterance). livekit imports stay lazy.
"""
from __future__ import annotations

import asyncio
import contextlib

from stewardai.bridge.transport import MeetingConnection, MultiplexFrameServer
from stewardai.bridge.vexa_control import RedisControl
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("agent.meeting_runner")


async def _pump_paced(audio_out, conn: MeetingConnection) -> None:  # noqa: ANN001
    """Drain the paced output and stream each frame to the bot at ~real time.

    Sends each AudioFrame's PCM via the connection's send() (a ``0x00`` PCM frame
    back on the same socket that delivers inbound meeting audio). Pacing is
    self-determined by each frame's own sample_rate.
    """
    async for frame in audio_out.paced_frames():
        await conn.send(frame.pcm)


async def _feed_inbound(conn: MeetingConnection, audio_in, on_first_frame=None) -> None:  # noqa: ANN001
    """Forward inbound socket PCM into the LiveKit PushAudioInput.

    The FIRST inbound PCM frame (type ``0x00``, NOT the handshake) means the bot
    is admitted and meeting audio is flowing — the right moment to fire
    ``on_first_frame`` (unmute), avoiding the startup-mic_on / admission race that
    leaves the bot muted if the agent starts before the bot is let in.
    """
    first = True
    async for pcm in conn.frames():
        if first:
            first = False
            if on_first_frame is not None:
                on_first_frame()
        audio_in.push(pcm)
    with contextlib.suppress(Exception):
        audio_in.end_input()


async def _keepalive(llm_backend, interval_s: float) -> None:  # noqa: ANN001
    """Ping the shared LLM connection every ``interval_s`` so a turn after silence
    (or the first turn after an admission wait) doesn't pay the ~5-8s cold-connection
    cost. No-op when interval_s <= 0; best-effort (warmup_llm suppresses errors)."""
    if interval_s <= 0:
        return
    from stewardai.llm.warmup import warmup_llm

    while True:
        await asyncio.sleep(interval_s)
        await warmup_llm(llm_backend, quiet=True)


async def _resolve_user_id(supabase_client, native_meeting_id: str) -> str | None:  # noqa: ANN001
    """Resolve the meeting owner's user_id from Supabase, keyed by native_meeting_id.

    Picks the most recent ``meetings`` row for this native id whose bot_status is
    active ('joining' | 'pending' | 'in_meeting'); falls back to the most recent
    row with that native id regardless of status. Returns ``None`` (meeting runs
    WITHOUT Composio tools) on any error or no match — never raises.
    """
    if supabase_client is None:
        return None
    try:
        active = ("joining", "pending", "in_meeting")
        resp = await (
            supabase_client.table("meetings")
            .select("user_id, bot_status, created_at")
            .eq("native_meeting_id", native_meeting_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        # Prefer an active-status row; else the most recent row of any status.
        for row in rows:
            if row.get("bot_status") in active and row.get("user_id"):
                return str(row["user_id"])
        for row in rows:
            if row.get("user_id"):
                return str(row["user_id"])
    except Exception as exc:  # noqa: BLE001 - resolution failure must not fail the meeting
        _log.warning(
            "user_id_resolution_failed",
            native_meeting_id=native_meeting_id,
            error=str(exc),
        )
    return None


class MeetingSession:
    """One meeting's runtime: an AgentSession + I/O + control, scoped to one bot conn.

    All heavy backends (STT/LLM/TTS) are passed in PRE-BUILT and SHARED across
    sessions. Everything else — the AgentSession, PushAudioInput, QueueAudioOutput,
    Redis control channel, speaker subscriber, and pump tasks — is per-session so
    one meeting dying can never affect another.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        meeting_id: int,
        native_meeting_id: str,
        user_id: str | None,
        conn: MeetingConnection,
        stt_backend,  # noqa: ANN001 - shared, pre-built
        llm_backend,  # noqa: ANN001 - shared, pre-built
        tts_backend,  # noqa: ANN001 - shared, pre-built
        composio_service,  # noqa: ANN001 - shared or None
        supabase_client,  # noqa: ANN001 - shared or None
    ) -> None:
        self._s = settings
        self.meeting_id = meeting_id
        self.native_meeting_id = native_meeting_id
        self.user_id = user_id
        self._conn = conn
        self._stt = stt_backend
        self._llm = llm_backend
        self._tts = tts_backend
        self._composio = composio_service
        self._supabase = supabase_client

        self._mid = str(meeting_id)
        self._transcript: list[str] = []
        self._actions_writer = None
        self._session = None
        self._agent = None
        self._audio_in = None
        self._audio_out = None
        self._control: RedisControl | None = None
        self._speaker_sub = None
        self._tasks: list[asyncio.Task] = []

    def rebind(self, conn: MeetingConnection) -> None:
        """Swap this session onto a new bot connection (reconnect)."""
        self._conn = conn

    async def _set_bot_status(self, status: str) -> None:
        """Best-effort meetings.bot_status writeback keyed by native_meeting_id.

        Now that the scheduler no longer reaps a per-meeting agent, the
        multiplexer owns the meeting lifecycle: 'in_meeting' when the session
        starts, 'done' on teardown. Targets the newest row for this
        native_meeting_id whose status is still active (joining/pending/
        in_meeting). Fully guarded — a writeback failure never breaks the session.
        """
        if self._supabase is None or not self.native_meeting_id:
            return
        try:
            active = ("joining", "pending", "in_meeting")
            resp = await (
                self._supabase.table("meetings")
                .select("id, bot_status, created_at")
                .eq("native_meeting_id", self.native_meeting_id)
                .order("created_at", desc=True)
                .execute()
            )
            rows = resp.data or []
            target = next((r for r in rows if r.get("bot_status") in active), None)
            if target is None:
                target = rows[0] if rows else None
            if target is None or not target.get("id"):
                return
            await (
                self._supabase.table("meetings")
                .update({"bot_status": status})
                .eq("id", target["id"])
                .execute()
            )
            _log.info(
                "bot_status_writeback",
                meeting=self._mid,
                native_meeting_id=self.native_meeting_id,
                status=status,
            )
        except Exception as exc:  # noqa: BLE001 — writeback must never break the session
            _log.warning(
                "bot_status_writeback_failed",
                meeting=self._mid,
                status=status,
                error=str(exc),
            )

    async def build(self) -> None:
        """Construct the per-session AgentSession + I/O and register handlers."""
        from livekit.agents import metrics as lk_metrics

        from stewardai.agent.assembly import build_meeting_agent, build_session
        from stewardai.agent.summary import generate_summary, write_summary
        from stewardai.bridge.audio_input import _build_push_audio_input
        from stewardai.bridge.audio_output import QueueAudioOutput
        from stewardai.bridge.speaker_events import SpeakerSubscriber, SpeakerTracker

        s = self._s
        loop = asyncio.get_running_loop()
        tracker = SpeakerTracker()
        self._control = RedisControl(s.redis_url, self._mid)

        # Composio live tools (only when we resolved a user_id + Composio is enabled).
        live_tools: list = []
        if s.composio_enabled and self.user_id and self._composio is not None:
            try:
                from stewardai.agent.actions import AgentActionsWriter
                from stewardai.agent.live_tools import build_live_tool_functions

                self._actions_writer = AgentActionsWriter(
                    meeting_id=self._mid,
                    user_id=self.user_id,
                    client=self._supabase,
                )
                live_tools = build_live_tool_functions(
                    self.user_id, self._mid, self._composio, self._actions_writer
                )
                _log.info(
                    "composio_live_tools_ready",
                    meeting_id=self._mid,
                    user_id=self.user_id,
                    count=len(live_tools),
                )
            except Exception as exc:  # noqa: BLE001 - meeting continues without tools
                _log.warning(
                    "composio_live_tools_setup_failed",
                    meeting_id=self._mid,
                    error=str(exc),
                )
                live_tools = []

        # Shared backends passed through; build_session builds fresh nodes/plugins
        # around them per session (see run_multiplexer's sharing note).
        # decide() needs the committed turn, not partials -> preemptive off (gated).
        self._session = build_session(
            s,
            stt_backend=self._stt,
            llm_backend=self._llm,
            tts_backend=self._tts,
            gated=True,
        )

        async def _write_summary(trigger: str) -> None:
            with contextlib.suppress(Exception):
                summary = await asyncio.wait_for(
                    generate_summary(self._llm, self._transcript), timeout=15.0
                )
                write_summary(self._mid, summary)
                _log.info("summary_written", trigger=trigger, meeting=self._mid)

        self._write_summary = _write_summary
        transcript_path = f"evals/out/meeting-{self._mid}-transcript.txt"
        self._agent = build_meeting_agent(
            s,
            tracker=tracker,
            transcript=self._transcript,
            on_summarize=lambda: loop.create_task(_write_summary("command")),
            transcript_path=transcript_path,
            live_tools=live_tools or None,
            user_id=self.user_id,
        )

        self._audio_in = _build_push_audio_input()()
        self._audio_out = QueueAudioOutput(label=f"vexa-{self._mid}")
        self._session.input.audio = self._audio_in
        self._session.output.audio = self._audio_out

        def _on_clear() -> None:
            # Barge-in: stop the agent's current speech. Mic stays ON (see below).
            loop.create_task(self._control.speak_stop())

        self._audio_out.on_clear = _on_clear
        # Mic stays ON for the whole session (no per-utterance gating); mic_on is
        # published once on the FIRST inbound PCM frame (bot admitted + audio
        # flowing), NOT at startup — that would race admission and leave it muted.

        def _ms(x):  # noqa: ANN001, ANN202
            return round(x * 1000) if x is not None else None

        def _log_metrics(ev) -> None:  # noqa: ANN001
            m = ev.metrics
            if isinstance(m, lk_metrics.EOUMetrics):
                _log.info("turn_eou", meeting=self._mid,
                          eou_delay_ms=_ms(m.end_of_utterance_delay),
                          transcription_delay_ms=_ms(m.transcription_delay))
            elif isinstance(m, lk_metrics.STTMetrics):
                _log.info("turn_stt", meeting=self._mid, duration_ms=_ms(m.duration))
            elif isinstance(m, lk_metrics.LLMMetrics):
                _log.info("turn_llm", meeting=self._mid, ttft_ms=_ms(m.ttft),
                          duration_ms=_ms(m.duration))
            elif isinstance(m, lk_metrics.TTSMetrics):
                _log.info("turn_tts", meeting=self._mid, ttfb_ms=_ms(m.ttfb),
                          duration_ms=_ms(m.duration))

        self._session.on("metrics_collected", _log_metrics)
        self._tracker = tracker
        self._SpeakerSubscriber = SpeakerSubscriber

    async def start(self) -> None:
        """Start the AgentSession + speaker subscriber + pump tasks for this meeting."""
        loop = asyncio.get_running_loop()
        await self._session.start(agent=self._agent)
        self._speaker_sub = self._SpeakerSubscriber(
            self._s.redis_url, self._mid, self._tracker
        )
        with contextlib.suppress(Exception):
            await self._speaker_sub.start()

        def _unmute_once() -> None:
            loop.create_task(self._control.mic_on())

        pump = asyncio.create_task(_pump_paced(self._audio_out, self._conn))
        feed = asyncio.create_task(
            _feed_inbound(self._conn, self._audio_in, on_first_frame=_unmute_once)
        )
        self._tasks = [pump, feed]
        _log.info("meeting_session_started", meeting=self._mid, user_id=self.user_id)
        # Multiplexer now owns the lifecycle writeback (scheduler no longer reaps).
        await self._set_bot_status("in_meeting")
        # feed ends when the bot disconnects (frames() hits EOF) — that's teardown.
        self._feed_task = feed

    async def wait_until_disconnect(self) -> None:
        """Block until this connection's inbound PCM stream ends (bot disconnect)."""
        await self._feed_task

    async def teardown(self) -> None:
        """Summary + post-meeting actions, then tear down THIS session only.

        Does NOT touch shared backends or the listen socket. Best-effort/guarded so
        one failing teardown can't take down the process or other sessions.
        """
        for t in self._tasks:
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t
        # Best-effort summary backup (the "summarize" command trigger is reliable).
        with contextlib.suppress(Exception):
            await self._write_summary("shutdown")
        # Post-meeting action extraction (best-effort, guarded, timed out).
        if (
            self._composio is not None
            and self.user_id
            and self._actions_writer is not None
        ):
            with contextlib.suppress(Exception):
                from stewardai.agent.actions import extract_post_meeting_actions

                await asyncio.wait_for(
                    extract_post_meeting_actions(
                        self._llm,
                        self._transcript,
                        user_id=self.user_id,
                        meeting_id=self._mid,
                        composio_service=self._composio,
                        writer=self._actions_writer,
                    ),
                    timeout=15.0,
                )
                _log.info("post_meeting_actions_extracted", meeting=self._mid)
        with contextlib.suppress(Exception):
            await self._session.aclose()
        if self._control is not None:
            with contextlib.suppress(Exception):
                await self._control.mic_off()
            with contextlib.suppress(Exception):
                await self._control.aclose()
        if self._speaker_sub is not None:
            with contextlib.suppress(Exception):
                await self._speaker_sub.aclose()
        with contextlib.suppress(Exception):
            await self._conn.aclose()
        # Close the meeting lifecycle now that the scheduler no longer reaps agents.
        await self._set_bot_status("done")
        _log.info("meeting_session_torn_down", meeting=self._mid)


async def run_multiplexer(settings: Settings | None = None) -> None:
    """Run the multiplexing meeting agent: ONE process, ONE port, N bot sessions.

    Builds the heavy shared backends ONCE, warms + keepalives the LLM, opens the
    cloud-plugin http_context, constructs the shared ComposioService + Supabase
    client, then listens on a ``MultiplexFrameServer``. Each bot handshake spins up
    an independent ``MeetingSession``; the bot's disconnect tears that session down
    without touching anything shared.
    """
    s = settings or get_settings()
    from livekit.agents import AgentSession  # noqa: F401  (ensures extra present)
    from livekit.agents.utils import http_context

    from stewardai.factory import make_llm, make_stt, make_tts
    from stewardai.llm.warmup import warmup_llm

    # ---- Process-global shared state, built ONCE ----
    # Backends: heavy models load exactly once and are reused by every session.
    # SHARING NOTE: build_session wraps these in FRESH per-session nodes
    # (build_stt_node/build_llm_node/build_tts_node) each call, so the model
    # WEIGHTS are shared while each session gets its own thin node wrapper. Cloud
    # STT/TTS (STT_BACKEND=deepgram / TTS_BACKEND=cartesia/deepgram) IGNORE the
    # shared backend and construct their own plugin instance per session inside
    # build_session — correct, since those plugins hold per-session streaming
    # clients that cannot be shared across concurrent AgentSessions. The local
    # backends (whisper/kokoro/litellm) ARE safely shared (stateless per call).
    llm_backend = make_llm(s)
    stt_backend = make_stt(s) if s.stt_backend != "deepgram" else None
    tts_backend = (
        make_tts(s) if s.tts_backend not in ("cartesia", "deepgram") else None
    )

    composio_service = None
    supabase_client = None
    if s.composio_enabled:
        with contextlib.suppress(Exception):
            from stewardai.integrations.composio_service import ComposioService

            composio_service = ComposioService()
    if s.supabase_url and s.supabase_service_role_key:
        with contextlib.suppress(Exception):
            from stewardai.integrations.supabase_client import create_service_client

            supabase_client = await create_service_client(s)

    sessions: dict[int, MeetingSession] = {}

    async def _on_session(
        meeting_id: int, native_meeting_id: str, conn: MeetingConnection
    ) -> None:
        # Reconnect: an existing meeting_id means the bot re-dialed. Tear down the
        # OLD session's socket binding + wiring and build a fresh session on the new
        # connection (never a duplicate live pair). Closing the old conn makes the
        # old invocation's wait_until_disconnect() return; its finally sees it is no
        # longer the dict's owner (identity check below) and does NOT touch the new
        # entry.
        existing = sessions.get(meeting_id)
        if existing is not None:
            _log.info("meeting_reconnect_rebind", meeting_id=meeting_id)
            sessions.pop(meeting_id, None)
            with contextlib.suppress(Exception):
                await existing.teardown()

        user_id = await _resolve_user_id(supabase_client, native_meeting_id)
        if user_id is None:
            _log.info(
                "no_user_id_running_without_tools",
                meeting_id=meeting_id,
                native_meeting_id=native_meeting_id,
            )

        session = MeetingSession(
            s,
            meeting_id=meeting_id,
            native_meeting_id=native_meeting_id,
            user_id=user_id,
            conn=conn,
            stt_backend=stt_backend,
            llm_backend=llm_backend,
            tts_backend=tts_backend,
            composio_service=composio_service,
            supabase_client=supabase_client,
        )
        sessions[meeting_id] = session
        try:
            await session.build()
            await session.start()
            await session.wait_until_disconnect()
        finally:
            # Only remove the dict entry if WE still own it — a reconnect may have
            # already replaced us with a newer session under the same key.
            if sessions.get(meeting_id) is session:
                sessions.pop(meeting_id, None)
            with contextlib.suppress(Exception):
                await session.teardown()

    server = MultiplexFrameServer(_on_session, s.bridge_tcp_host, s.bridge_tcp_port)

    # Warm the shared LLM before listening so the first real turn is cheap.
    await warmup_llm(llm_backend)

    async with http_context.open():
        await server.start()
        keepalive = asyncio.create_task(_keepalive(llm_backend, s.llm_keepalive_s))
        _log.info(
            "multiplexer_started",
            listen=f"{s.bridge_tcp_host}:{s.bridge_tcp_port}",
            stt=s.stt_backend,
            tts=s.tts_backend,
        )
        try:
            await asyncio.Event().wait()
        finally:
            keepalive.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await keepalive
            # Tear down any still-live sessions, then the listen socket.
            for session in list(sessions.values()):
                with contextlib.suppress(Exception):
                    await session.teardown()
            sessions.clear()
            with contextlib.suppress(Exception):
                await server.aclose()
            if supabase_client is not None:
                # Supabase AsyncClient has no explicit aclose; GC handles it.
                pass


# Thin backwards-compatible alias: the scheduler stage will call run_multiplexer,
# but existing callers / docs referencing run_meeting still work (a meeting is now
# just one session inside the multiplexer). VEXA_MEETING_ID / VEXA_USER_ID are no
# longer needed (identity is per-connection via the handshake) but are ignored, not
# rejected, if still set.
async def run_meeting(settings: Settings | None = None) -> None:
    """Run the meeting agent as a multiplexer (see ``run_multiplexer``)."""
    await run_multiplexer(settings)


def _main() -> None:
    """CLI entrypoint: run the multiplexing meeting agent until interrupted (Ctrl-C).

    Config comes from env / .env: BRIDGE_TCP_HOST / BRIDGE_TCP_PORT (bots connect
    here), STT_BACKEND / TTS_BACKEND, GEMINI_API_KEY, REDIS_URL, SUPABASE_URL /
    SUPABASE_SERVICE_ROLE_KEY (for per-meeting user_id resolution), COMPOSIO_API_KEY.
    Meeting identity is per-connection (handshake), so VEXA_MEETING_ID is unused.
    """
    from stewardai.common.logging import configure_logging

    s = get_settings()
    configure_logging(level=s.log_level, fmt=s.log_format)
    _log.info(
        "meeting_multiplexer_boot",
        listen=f"{s.bridge_tcp_host}:{s.bridge_tcp_port}",
        stt=s.stt_backend,
        tts=s.tts_backend,
    )
    try:
        asyncio.run(run_multiplexer(s))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    _main()
