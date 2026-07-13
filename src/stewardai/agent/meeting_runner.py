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

# Separator between the stable speaker id and the display name inside a per-speaker
# frame key ("<id>\x1f<name>"); mirrors transport/DeepgramSpeakerTranscriber.
_SPEAKER_KEY_SEP = "\x1f"


async def _pump_paced(audio_out, conn: MeetingConnection) -> None:  # noqa: ANN001
    """Drain the paced output and stream each frame to the bot at ~real time.

    Sends each AudioFrame's PCM via the connection's send() (a ``0x00`` PCM frame
    back on the same socket that delivers inbound meeting audio). Pacing is
    self-determined by each frame's own sample_rate.

    Emits ``tts_pump`` (first frame + periodic) / ``tts_pump_end`` so the
    outbound audio path (agent → bot playback) is observable — without it a
    silent bot is indistinguishable from "TTS never produced audio", "the pump
    never ran", and "the bot never played it".
    """
    mid = getattr(conn, "meeting_id", "?")
    total = 0
    frames = 0
    try:
        async for frame in audio_out.paced_frames():
            await conn.send(frame.pcm)
            total += len(frame.pcm)
            frames += 1
            if frames == 1 or frames % 50 == 0:
                _log.info("tts_pump", meeting=mid, frames=frames, bytes=total)
    finally:
        _log.info("tts_pump_end", meeting=mid, frames=frames, bytes=total)


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
        # Supabase meetings.id (UUID). self._mid is the Vexa int id, but the portal
        # keys transcript_segments/summaries/action_items/agent_actions on the UUID.
        # Resolved in build() before we write anything Supabase-side.
        self._meeting_uuid: str | None = None
        # Per-meeting STT keyterms (attendee names + domain terms) from the calendar
        # sync; fed to the Deepgram per-speaker transcriber. Empty if none / no column.
        self._meeting_keyterms: list[str] = []
        # Label for Steward's own spoken lines in the transcript (the owner's
        # configured bot display name; resolved in build(), defaults to "Steward").
        self._bot_label: str = "Steward"
        # Owner's IANA timezone (profiles.timezone) so calendar actions use their
        # LOCAL time, not UTC. Resolved in build(); defaults to UTC if unset.
        self._user_timezone: str = "UTC"
        # Owner's "let Steward speak in meetings" setting (profiles.allow_meeting_
        # speech). Resolved in build(); defaults to True (today's behavior) if the
        # column/row is missing or the query fails. When False the bot still joins
        # + transcribes, it just never speaks (mic never unmuted + prompt says so).
        self._speak_enabled: bool = True
        # Best-effort "prior context" brief (recent decisions/open items from the
        # meeting's Space and/or recap of the last occurrence of a recurring
        # series), injected into the system prompt ONLY when speaking is enabled
        # (see _resolve_meeting_brief). Empty string = nothing to inject.
        self._meeting_brief: str = ""
        self._transcript: list[str] = []
        # Attributed transcript built by the per-speaker path (real speaker names).
        # Preferred over _transcript for persistence/summary when populated.
        self._attributed_transcript: list[str] = []
        # Monotonic seq for LIVE transcript_segments inserts, shared across human
        # turns (combined STT recorder) and Steward's own lines, so the portal shows
        # them in order. Live persistence rides the RELIABLE combined transcript, not
        # the best-effort per-speaker path (which may produce nothing).
        self._live_seq: int = 0
        self._per_speaker = None
        self._actions_writer = None
        # Live tool-calling: Composio action schemas offered to the gated decide, and
        # the executor that runs a chosen action. None when Composio is off/blocked.
        # (Legacy gated path; the meeting now uses native_tools — see self._live_tools.)
        self._action_tools = None
        self._tool_executor = None
        # Native meeting tools registered on the agent (stay_silent gate + Composio
        # live actions); LiveKit executes them. _has_action_tools tracks whether any
        # real (non-gate) action tools loaded, for the prompt's tool-availability note.
        self._live_tools: list = []
        self._has_action_tools = False
        self._session = None
        self._agent = None
        self._audio_in = None
        self._audio_out = None
        self._control: RedisControl | None = None
        self._speaker_sub = None
        self._tasks: list[asyncio.Task] = []
        # Serializes _write_summary (voice-command trigger vs teardown) so the
        # persist delete-then-insert can never interleave with itself.
        self._summary_lock = asyncio.Lock()

    def rebind(self, conn: MeetingConnection) -> None:
        """Swap this session onto a new bot connection (reconnect)."""
        self._conn = conn

    def _transcript_for_output(self) -> list[str]:
        """Transcript for persistence + summary. Prefer the per-speaker attributed
        transcript (real names) ONLY when it is at least as complete as the combined
        one. The per-speaker path is best-effort and can produce nothing (or just a
        stray bot line): if we blindly preferred it, one attributed line would shadow
        the full combined conversation and the summary/final persist would drop every
        human turn (observed live: teardown wrote a single segment)."""
        if len(self._attributed_transcript) >= len(self._transcript):
            return self._attributed_transcript
        return self._transcript

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

    async def _resolve_meeting_uuid(self) -> None:
        """Resolve + cache the Supabase meetings.id (UUID) for this meeting.

        self._mid is the Vexa int id; the portal keys transcript_segments,
        summaries, action_items and agent_actions on meetings.id (uuid), so we
        need it before persisting anything. Picks the newest row for this
        native_meeting_id, preferring an active one. Best-effort — guarded.
        """
        if self._meeting_uuid or self._supabase is None or not self.native_meeting_id:
            return
        with contextlib.suppress(Exception):
            resp = await (
                self._supabase.table("meetings")
                .select("id, bot_status, created_at")
                .eq("native_meeting_id", self.native_meeting_id)
                .order("created_at", desc=True)
                .execute()
            )
            rows = resp.data or []
            active = ("joining", "pending", "in_meeting")
            target = next((r for r in rows if r.get("bot_status") in active), None)
            if target is None:
                target = rows[0] if rows else None
            if target and target.get("id"):
                self._meeting_uuid = target["id"]
                _log.info(
                    "meeting_uuid_resolved",
                    meeting=self._mid,
                    meeting_uuid=self._meeting_uuid,
                )
        # Reached the body (supabase + native_meeting_id present) but still no UUID
        # — the meetings row is missing or the query failed. Never silent: without
        # this UUID nothing persists to the portal.
        if not self._meeting_uuid:
            _log.warning(
                "meeting_uuid_unresolved",
                meeting=self._mid,
                native_meeting_id=self.native_meeting_id,
            )

    async def _resolve_keyterms(self) -> None:
        """Load this meeting's calendar-derived STT keyterms. Best-effort + separate
        from UUID resolution so a missing ``keyterms`` column can't break anything."""
        if self._supabase is None or not self._meeting_uuid:
            return
        with contextlib.suppress(Exception):
            resp = await (
                self._supabase.table("meetings")
                .select("keyterms")
                .eq("id", self._meeting_uuid)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            raw = (rows[0].get("keyterms") if rows else "") or ""
            self._meeting_keyterms = [t.strip() for t in raw.split(",") if t.strip()]
            if self._meeting_keyterms:
                _log.info(
                    "meeting_keyterms_loaded",
                    meeting=self._mid,
                    count=len(self._meeting_keyterms),
                )

    async def _resolve_profile(self) -> None:
        """Load the owner's bot display name + timezone + speak setting from their
        profile. Separate guarded queries so a missing column (e.g. ``timezone`` or
        ``allow_meeting_speech``) can't lose the others."""
        if self._supabase is None or not self.user_id:
            return
        with contextlib.suppress(Exception):
            resp = await (
                self._supabase.table("profiles")
                .select("bot_name")
                .eq("user_id", self.user_id)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            name = ((rows[0].get("bot_name") if rows else None) or "").strip()
            if name:
                self._bot_label = name
        with contextlib.suppress(Exception):
            resp = await (
                self._supabase.table("profiles")
                .select("timezone")
                .eq("user_id", self.user_id)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            tz = ((rows[0].get("timezone") if rows else None) or "").strip()
            if tz:
                self._user_timezone = tz
        with contextlib.suppress(Exception):
            resp = await (
                self._supabase.table("profiles")
                .select("allow_meeting_speech")
                .eq("user_id", self.user_id)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            if rows and rows[0].get("allow_meeting_speech") is not None:
                self._speak_enabled = bool(rows[0]["allow_meeting_speech"])

    async def _resolve_meeting_brief(self) -> None:
        """Build the in-meeting briefing (prior Space/series context) — ONLY when
        speaking is enabled (silent mode makes zero LLM calls, so a brief no one
        ever reads is pointless). Fetches this meeting's row best-effort (title/
        attendees/recurring_event_id/space_id — ``attendees`` may be absent on an
        older schema) and hands it to ``build_meeting_brief``, which is itself
        fully best-effort. Any failure here — missing column, RLS, no match —
        just leaves ``self._meeting_brief`` at its default "" (no crash)."""
        if not self._speak_enabled or self._supabase is None or not self.user_id:
            return
        if not self._meeting_uuid:
            return
        with contextlib.suppress(Exception):
            resp = await (
                self._supabase.table("meetings")
                .select("id,title,attendees,recurring_event_id,space_id")
                .eq("id", self._meeting_uuid)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            if rows:
                from stewardai.agent.kb.briefing import build_meeting_brief

                self._meeting_brief = await build_meeting_brief(
                    self._supabase, user_id=self.user_id, meeting=rows[0]
                )
                if self._meeting_brief:
                    _log.info(
                        "meeting_brief_built",
                        meeting=self._mid,
                        chars=len(self._meeting_brief),
                    )

    async def _tapped_speaker_frames(self):  # noqa: ANN202 - async generator
        """Wrap the per-speaker frame stream, updating the SpeakerTracker with each
        frame's carried NAME so the combined transcript can label turns with real
        names. The bot publishes no start/end speaker events on this platform — the
        only place the name is available is these per-speaker frames — so without
        this tap every combined turn is labeled the generic "[Speaker]:".

        The frame key is "<stable-speaker-id>\\x1f<display name>" (see transport
        ``_pack_speaker_pcm``); we take the name and mark it most-recently-active.
        """
        async for key, pcm in self._conn.speaker_frames():
            name = key.split(_SPEAKER_KEY_SEP, 1)[1] if _SPEAKER_KEY_SEP in key else ""
            tracker = getattr(self, "_tracker", None)
            if name and tracker is not None:
                tracker.note_active(name)
            yield (key, pcm)

    async def _consume_speaker_names(self) -> None:
        """Drain the per-speaker frames PURELY to feed the SpeakerTracker with real
        speaker names — no Deepgram, no transcription. Used when the Deepgram
        per-speaker transcriber is disabled (e.g. a fully-local whisper+kokoro GPU
        run with no DEEPGRAM_API_KEY): names ride the frames themselves, so the
        combined transcript is still attributed. Also drains the per-speaker queue
        so it can't grow unbounded when nothing else consumes it."""
        async for _key, _pcm in self._tapped_speaker_frames():
            pass

    async def _run_live_action(self, slug: str, args: dict) -> dict:
        """Execute ONE Composio action for a directed live request and return the raw
        result (the caller phrases it aloud). Runs OFF the event loop — the SDK call
        is synchronous + network, so inline it would freeze the whole meeting."""
        result = await asyncio.to_thread(
            self._composio.execute,
            self.user_id,
            slug,
            args or {},
            default_timezone=self._user_timezone,
        )
        _log.info(
            "live_action_executed",
            meeting=self._mid,
            slug=slug,
            successful=bool(isinstance(result, dict) and result.get("successful")),
        )
        # Best-effort: log to agent_actions so the portal's "Steward's Actions" shows it.
        if self._actions_writer is not None:
            with contextlib.suppress(Exception):
                ok = bool(isinstance(result, dict) and result.get("successful"))
                err = None
                if not ok and isinstance(result, dict):
                    err = str(result.get("error") or "tool reported failure")
                await self._actions_writer.insert(
                    source="directed",
                    toolkit=slug.split("_", 1)[0].lower(),
                    action_slug=slug,
                    args=args or {},
                    risk="low",
                    title=slug,
                    state="done" if ok else "failed",
                    result=result if isinstance(result, dict) else {"result": result},
                    error=err,
                )
        return result if isinstance(result, dict) else {"result": result}

    async def _persist_live_line(self, labeled: str) -> None:
        """Persist ONE finalized transcript line ("[Speaker]: text") to Supabase as
        it arrives, so the portal shows the transcript live. Uses a single monotonic
        seq across human turns (the reliable combined STT recorder) and Steward's own
        lines. Best-effort and fully guarded — a persist failure never breaks a turn.

        No-op without a resolved meetings.id UUID (transcript_segments.meeting_id is a
        uuid FK, so writing without it would fail every insert)."""
        if self._supabase is None or not self._meeting_uuid:
            return
        from stewardai.agent.persistence import (
            _parse_segment,
            persist_transcript_segment,
        )

        speaker, text = _parse_segment(labeled)
        if not text:
            return
        seq = self._live_seq
        self._live_seq += 1
        await persist_transcript_segment(
            self._supabase, self._meeting_uuid, seq, speaker, text
        )

    async def _record_bot_line(self, text: str) -> None:
        """Append Steward's own spoken reply to the transcript (+ live-persist), so
        the meeting record shows the bot's side, not just the humans'."""
        text = (text or "").strip()
        if not text:
            return
        line = f"[{self._bot_label}]: {text}"
        self._attributed_transcript.append(line)
        self._transcript.append(line)
        with contextlib.suppress(Exception):
            from stewardai.agent.summary import append_transcript_line

            append_transcript_line(
                f"evals/out/meeting-{self._mid}-transcript-attributed.txt", line
            )
        await self._persist_live_line(line)

    async def build(self) -> None:
        """Construct the per-session AgentSession + I/O and register handlers."""
        from livekit.agents import metrics as lk_metrics

        from stewardai.agent.assembly import (
            build_meeting_agent,
            build_meeting_system,
            build_session,
        )
        from stewardai.agent.summary import generate_summary, write_summary
        from stewardai.bridge.audio_input import _build_push_audio_input
        from stewardai.bridge.audio_output import QueueAudioOutput
        from stewardai.bridge.speaker_events import SpeakerSubscriber, SpeakerTracker

        s = self._s
        loop = asyncio.get_running_loop()
        tracker = SpeakerTracker()
        self._control = RedisControl(s.redis_url, self._mid)

        # Resolve the Supabase meetings.id (UUID) up front — everything we persist
        # (agent_actions, transcript, summary, action items) keys on it.
        await self._resolve_meeting_uuid()
        # Load calendar-derived keyterms (attendee names + domain terms) for STT.
        await self._resolve_keyterms()
        # Owner's bot display name + timezone (for transcript label + calendar actions).
        await self._resolve_profile()
        # In-meeting briefing (prior Space/series context) — speak-enabled only;
        # see _resolve_meeting_brief for the full gating/degradation rationale.
        await self._resolve_meeting_brief()

        # Native meeting tools (LiveKit executes them directly, managing the
        # speak→tool→speak utterance boundaries). The stay_silent gate is registered
        # (when speech is enabled) — under the native flow it's how the agent stays
        # quiet on ambient talk. Composio live actions are added when we resolved a
        # user_id + Composio is enabled + we have the meetings.id UUID
        # (agent_actions.meeting_id FK).
        #
        # SILENT MODE (allow_meeting_speech off): the agent never speaks and the LLM
        # is never invoked in-meeting, so NO in-meeting tools are loaded at all (no
        # stay_silent gate, no live Composio actions — it can't act if it can't
        # participate). We STILL build the AgentActionsWriter, because POST-meeting
        # action extraction/filing runs in teardown and writes through it — that is
        # desired and unaffected by silent mode.
        from stewardai.agent.live_tools import (
            build_live_tool_functions,
            build_stay_silent_tool,
        )

        self._live_tools = []
        self._has_action_tools = False
        if self._speak_enabled:
            _ss = build_stay_silent_tool()
            if _ss is not None:
                self._live_tools.append(_ss)
        _composio_ready = s.composio_enabled and self.user_id and self._composio is not None
        if _composio_ready and not self._meeting_uuid:
            # agent_actions.meeting_id is a uuid FK — without the resolved meetings.id
            # UUID every insert would violate it, so skip live actions (log) rather
            # than write the Vexa int and fail silently.
            _log.warning(
                "live_tools_skipped_no_meeting_uuid",
                meeting=self._mid,
                native_meeting_id=self.native_meeting_id,
            )
        if _composio_ready and self._meeting_uuid:
            try:
                from stewardai.agent.actions import AgentActionsWriter

                # Always created: post-meeting extraction/filing (teardown) writes
                # action_items through this, and that runs even in silent mode.
                self._actions_writer = AgentActionsWriter(
                    meeting_id=self._meeting_uuid,
                    user_id=self.user_id,
                    client=self._supabase,
                )
                if self._speak_enabled:
                    _actions = build_live_tool_functions(
                        self.user_id,
                        self._meeting_uuid,
                        self._composio,
                        self._actions_writer,
                        default_timezone=self._user_timezone,
                    )
                    self._live_tools.extend(_actions)
                    self._has_action_tools = bool(_actions)
                    _log.info(
                        "composio_live_tools_ready",
                        meeting_id=self._mid,
                        user_id=self.user_id,
                        count=len(_actions),
                    )
                else:
                    # Silent notetaker: no live in-meeting tools, but the writer is
                    # kept for post-meeting extraction/filing.
                    _log.info(
                        "composio_live_tools_skipped_silent_mode",
                        meeting_id=self._mid,
                        user_id=self.user_id,
                    )
            except Exception as exc:  # noqa: BLE001 - meeting continues without actions
                # Composio off/blocked (e.g. WAF) -> no live actions; the prompt's
                # no-tools note keeps the agent from promising actions it can't do.
                _log.warning(
                    "composio_live_tools_setup_failed",
                    meeting_id=self._mid,
                    error=str(exc),
                )

        # Agent identity + wake word = the owner's DISPLAY NAME (self._bot_label),
        # never a hardcoded "Steward". These keyterms bias the STT toward the wake
        # name + domain/participant terms so the transcript that drives decide()
        # hears the name (not "Stuart"). Deduped, order-preserving.
        _kt_conf = [t.strip() for t in (s.stt_keyterms or "").split(",") if t.strip()]
        self._keyterms = list(
            dict.fromkeys(
                k for k in (self._bot_label, *_kt_conf, *self._meeting_keyterms) if k
            )
        )
        # System prompt carries the display name AND whether external tools actually
        # loaded — so with no tools it won't promise "checking your calendar".
        # The TTS voice can only be HEARD in certain languages; tell the prompt so the
        # model never replies in a language it can't speak aloud (kokoro = English;
        # Indic Parler-TTS/MMS also do Urdu + Hindi). Extend when adding a TTS backend.
        _spoken = {
            "indic_parler": "English, Urdu, or Hindi",
            "mms": "English, Urdu, or Hindi",
        }.get(self._s.tts_backend, "English")
        # Current date/time in the OWNER's timezone, so the model resolves "today",
        # "tomorrow", "next Monday", "in an hour" correctly (without this it has no
        # date reference and scheduled events in its training-prior year, e.g. 2024).
        from datetime import datetime
        from zoneinfo import ZoneInfo

        try:
            _now = datetime.now(ZoneInfo(self._user_timezone))
            _today = f"{_now.strftime('%A, %B %d, %Y, %I:%M %p')} {self._user_timezone}"
        except Exception:  # noqa: BLE001 - bad/unknown tz string must not break setup
            _now = datetime.now(ZoneInfo("UTC"))
            _today = f"{_now.strftime('%A, %B %d, %Y, %I:%M %p')} UTC"
        meeting_system = build_meeting_system(
            self._bot_label,
            tools_available=self._has_action_tools,
            spoken_languages=_spoken,
            today=_today,
            speak_enabled=self._speak_enabled,
            prior_context=self._meeting_brief,
        )

        # Shared backends passed through; build_session builds fresh nodes/plugins
        # around them per session (see run_multiplexer's sharing note).
        # native_tools=True: LiveKit owns the tool loop; the agent's registered tools
        # (Composio actions + stay_silent gate, wired below) are executed by the
        # framework, which speaks a preamble BEFORE the tool and the result after.
        # silent=True (allow_meeting_speech off): the LLM node never invokes the model
        # on any turn — STT + turn detection still run (transcript captured), but there
        # is ZERO per-turn in-meeting inference. STT/transcription is deliberately
        # untouched so notes + the post-meeting summary/extraction still happen.
        self._session = build_session(
            s,
            stt_backend=self._stt,
            llm_backend=self._llm,
            tts_backend=self._tts,
            native_tools=True,
            silent=not self._speak_enabled,
            system=meeting_system,
            keyterms=self._keyterms,
        )

        async def _write_summary(
            trigger: str, transcript: list[str] | None = None
        ) -> None:
            # Serialize: the "summarize" voice command and teardown can both call
            # this; the persist delete-then-insert must not interleave with itself.
            async with self._summary_lock:
                with contextlib.suppress(Exception):
                    if transcript is None:
                        transcript = self._transcript_for_output()
                    summary = await asyncio.wait_for(
                        generate_summary(self._llm, transcript, user_id=self.user_id),
                        timeout=15.0,
                    )
                    write_summary(self._mid, summary)
                    _log.info("summary_written", trigger=trigger, meeting=self._mid)
                    # Persist to Supabase so the portal panels populate (keyed on the
                    # meetings.id UUID). Retry resolution — the meetings row may not
                    # have existed at build() but does by now. Timed out so a hung
                    # Supabase can't wedge teardown.
                    if self._supabase is not None:
                        if not self._meeting_uuid:
                            await self._resolve_meeting_uuid()
                        if self._meeting_uuid:
                            from stewardai.agent.persistence import (
                                persist_meeting_artifacts,
                            )

                            await asyncio.wait_for(
                                persist_meeting_artifacts(
                                    self._supabase,
                                    self._meeting_uuid,
                                    transcript,
                                    summary,
                                ),
                                timeout=10.0,
                            )
                        else:
                            _log.warning(
                                "persist_skipped_no_meeting_uuid",
                                meeting=self._mid,
                                native_meeting_id=self.native_meeting_id,
                            )

        self._write_summary = _write_summary
        # Per-speaker attributed transcript, built in parallel to the AgentSession.
        # Deepgram streaming (keyterm-boosted + real-time-persisted) when a Deepgram
        # key is configured; otherwise no per-speaker path and the combined transcript
        # is the fallback. Populated only when the bot forwards per-speaker frames.
        self._per_speaker = None
        if s.deepgram_api_key:
            from stewardai.agent.assembly import make_deepgram_speaker_stt
            from stewardai.agent.deepgram_speaker_transcriber import (
                DeepgramSpeakerTranscriber,
            )

            self._per_speaker = DeepgramSpeakerTranscriber(
                lambda kt: make_deepgram_speaker_stt(s, kt),
                self._attributed_transcript,
                transcript_path=f"evals/out/meeting-{self._mid}-transcript-attributed.txt",
                # Live portal persistence is driven by the reliable combined transcript
                # (see on_line below), NOT this best-effort per-speaker path — which can
                # produce nothing and whose own seq space would collide with it. This
                # path still builds _attributed_transcript for the final (real-name)
                # teardown rewrite when it works.
                supabase=None,
                meeting_uuid=self._meeting_uuid,
                # Wake name + domain/participant terms (self._bot_label first).
                extra_keyterms=self._keyterms,
            )
        transcript_path = f"evals/out/meeting-{self._mid}-transcript.txt"
        self._agent = build_meeting_agent(
            s,
            tracker=tracker,
            transcript=self._transcript,
            on_summarize=lambda: loop.create_task(_write_summary("command")),
            transcript_path=transcript_path,
            # Persist each finalized human turn to the portal live (fire-and-forget so
            # a Supabase round-trip never adds latency to the turn hot path).
            on_line=lambda labeled: loop.create_task(self._persist_live_line(labeled)),
            # Native tool-calling: register the Composio live actions + the stay_silent
            # gate on the agent so LiveKit runs them (speak→tool→speak with correct
            # utterance boundaries). Same name/tool-availability-aware prompt.
            live_tools=self._live_tools,
            instructions=meeting_system,
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

        # Accumulate per-turn metrics so we can emit ONE readable latency line
        # ("turn_latency") showing the whole pipeline at a glance + the bottleneck,
        # instead of four scattered events you have to correlate by timestamp.
        turn: dict = {}

        def _log_metrics(ev) -> None:  # noqa: ANN001
            m = ev.metrics
            if isinstance(m, lk_metrics.EOUMetrics):
                turn["stt_ms"] = _ms(m.transcription_delay)
                turn["eou_ms"] = _ms(m.end_of_utterance_delay)
                _log.info("turn_eou", meeting=self._mid,
                          eou_delay_ms=turn["eou_ms"],
                          transcription_delay_ms=turn["stt_ms"])
            elif isinstance(m, lk_metrics.STTMetrics):
                _log.info("turn_stt", meeting=self._mid, duration_ms=_ms(m.duration))
            elif isinstance(m, lk_metrics.LLMMetrics):
                turn["llm_ttft_ms"] = _ms(m.ttft)
                _log.info("turn_llm", meeting=self._mid, ttft_ms=turn["llm_ttft_ms"],
                          duration_ms=_ms(m.duration))
            elif isinstance(m, lk_metrics.TTSMetrics):
                turn["tts_ttfb_ms"] = _ms(m.ttfb)
                # user-stopped-speaking → Steward-starts-speaking, broken down.
                reply = sum(
                    v for v in (turn.get("eou_ms"), turn.get("llm_ttft_ms"),
                                turn.get("tts_ttfb_ms")) if v
                )
                _log.info(
                    "turn_latency", meeting=self._mid,
                    stt_ms=turn.get("stt_ms"), eou_ms=turn.get("eou_ms"),
                    llm_ttft_ms=turn.get("llm_ttft_ms"),
                    tts_ttfb_ms=turn.get("tts_ttfb_ms"), reply_total_ms=reply,
                )
                _log.info("turn_tts", meeting=self._mid, ttfb_ms=turn["tts_ttfb_ms"],
                          duration_ms=_ms(m.duration))
                turn.clear()

        self._session.on("metrics_collected", _log_metrics)

        # Capture Steward's OWN spoken replies into the transcript (assistant items),
        # so the meeting record shows the bot's side too — not just the humans'.
        def _on_item_added(ev) -> None:  # noqa: ANN001
            item = getattr(ev, "item", None)
            if item is None or getattr(item, "role", None) != "assistant":
                return
            text = getattr(item, "text_content", None) or ""
            if text.strip():
                loop.create_task(self._record_bot_line(text))

        with contextlib.suppress(Exception):
            self._session.on("conversation_item_added", _on_item_added)

        self._tracker = tracker
        self._SpeakerSubscriber = SpeakerSubscriber

    async def start(self) -> None:
        """Start the AgentSession + speaker subscriber + pump tasks for this meeting."""
        loop = asyncio.get_running_loop()
        await self._session.start(agent=self._agent)
        # Warm the TTS websocket now (cold first synth ~12s → off the first reply).
        # Fire-and-forget; the throwaway audio is discarded, never played. Skipped
        # entirely in silent mode: the bot never speaks (LLM never runs, mic muted),
        # so opening the TTS connection would be pure waste.
        if self._speak_enabled:
            with contextlib.suppress(Exception):
                from stewardai.llm.warmup import warmup_tts

                tts_obj = getattr(self._session, "_steward_tts", None)
                if tts_obj is not None:
                    loop.create_task(warmup_tts(tts_obj, quiet=True))
        self._speaker_sub = self._SpeakerSubscriber(
            self._s.redis_url, self._mid, self._tracker
        )
        with contextlib.suppress(Exception):
            await self._speaker_sub.start()

        def _unmute_once() -> None:
            loop.create_task(self._control.mic_on())

        # When the owner has turned OFF "let Steward speak in meetings", never wire
        # the unmute callback at all — the mic stays muted for the ENTIRE session no
        # matter what the LLM decides (defense in depth alongside the prompt-level
        # silent-observer instruction in build_meeting_system). Transcription is
        # untouched: it rides the per-speaker frame tap + combined feed below, both
        # of which run regardless of on_first_frame.
        _on_first_frame = _unmute_once if self._speak_enabled else None

        pump = asyncio.create_task(_pump_paced(self._audio_out, self._conn))
        feed = asyncio.create_task(
            _feed_inbound(self._conn, self._audio_in, on_first_frame=_on_first_frame)
        )
        # Per-speaker transcription runs alongside the combined feed (Deepgram
        # streaming); harmless no-op for legacy bots (speaker_frames() stays empty).
        # Cancelled in teardown. Only started when a per-speaker transcriber exists.
        self._tasks = [pump, feed]
        # Per-speaker frames carry the speaker NAME and arrive regardless of the STT
        # backend. We always consume them so the combined transcript gets real names
        # (the tap feeds the SpeakerTracker). If Deepgram is configured, the
        # per-speaker transcriber drains the tapped stream (and ALSO builds the
        # attributed transcript); otherwise a lightweight name-only consumer runs so
        # attribution works fully local (whisper+kokoro, no DEEPGRAM_API_KEY).
        if self._per_speaker is not None:
            self._tasks.append(
                asyncio.create_task(
                    self._per_speaker.run(self._tapped_speaker_frames())
                )
            )
        else:
            self._tasks.append(asyncio.create_task(self._consume_speaker_names()))
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
        # Snapshot once so the summary's persisted transcript_segments.seq and the
        # extraction's action source_seq index into the SAME list (see
        # _transcript_for_output docstring: best-effort, can change across calls).
        teardown_transcript = self._transcript_for_output()
        with contextlib.suppress(Exception):
            await self._write_summary("shutdown", teardown_transcript)
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
                        teardown_transcript,
                        user_id=self.user_id,
                        meeting_id=self._meeting_uuid,
                        composio_service=self._composio,
                        writer=self._actions_writer,
                        default_timezone=self._user_timezone,
                    ),
                    timeout=15.0,
                )
                _log.info("post_meeting_actions_extracted", meeting=self._mid)
        # Knowledge Base ingestion (best-effort; never blocks teardown). Resolves
        # recurring_event_id/title from the meetings row the same way
        # _resolve_keyterms/_resolve_profile do; attendee_emails aren't stored
        # structured yet (Plan A1), so we pass [] until A2/B persist them.
        try:
            from stewardai.agent.kb.teardown import run_kb_ingest

            recurring_event_id = None
            meeting_title = ""
            if self._supabase is not None and self._meeting_uuid:
                with contextlib.suppress(Exception):
                    resp = await (
                        self._supabase.table("meetings")
                        .select("recurring_event_id,title")
                        .eq("id", self._meeting_uuid)
                        .limit(1)
                        .execute()
                    )
                    rows = resp.data or []
                    if rows:
                        recurring_event_id = rows[0].get("recurring_event_id")
                        meeting_title = (rows[0].get("title") or "").strip()

            await run_kb_ingest(
                client=self._supabase,
                llm=self._llm,
                user_id=self.user_id,
                meeting_id=self._meeting_uuid,
                transcript=teardown_transcript,
                recurring_event_id=recurring_event_id,
                attendee_emails=[],
                title=meeting_title,
            )
        except Exception as exc:  # noqa: BLE001
            _log.warning("kb_ingest_wire_failed", error=str(exc))
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
