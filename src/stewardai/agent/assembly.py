"""LiveKit ``AgentSession`` assembly — roomless.

Wires StewardAI's STT/LLM/TTS backends (via ``agent/nodes.py``) plus a Silero
VAD plugin and the LiveKit turn-detector (v1-mini, audio) into an
``AgentSession`` that runs WITHOUT a LiveKit room: audio comes in through our
``PushAudioInput`` (fed by the Vexa ``SocketAudioBridge``) and goes out through
our ``QueueAudioOutput`` (drained into the meeting by the bridge's player).

livekit is NOT a base dependency — it lives in the ``[cpu]`` / ``[cuda]`` extra.
So this module imports cleanly without livekit; every livekit import is LAZY
inside the build/run functions and will raise ``ImportError`` only when called
without the extra installed.

--- livekit-agents v1.x APIs adapted to (assumptions; verify on the box) ---

  * ``AgentSession(vad=, stt=, llm=, tts=, turn_detection=)`` — v1.x voice
    pipeline session. We pass our custom node instances directly.
  * ``Agent(instructions=...)`` — the persona/handler passed to ``session.start``.
  * Roomless start: ``await session.start(agent=agent)`` with NO ``room`` kwarg.
    (In v1.x ``room`` is optional; omitting it leaves I/O bound to
    ``session.input`` / ``session.output``, which we set explicitly.)
  * ``session.input.audio = <io.AudioInput>`` and
    ``session.output.audio = <io.AudioOutput>``.
  * VAD: ``livekit.plugins.silero.VAD.load()``.
  * Turn detector (audio, v1-mini "multilingual"):
    ``livekit.plugins.turn_detector.multilingual.MultilingualModel()``.
    NOTE: the import path/class for the turn detector has moved across 1.x
    (``turn_detector.EOUModel`` -> ``turn_detector.multilingual.MultilingualModel``
    / ``turn_detector.english.EnglishModel``). We try the multilingual class and
    fall back to the legacy ``EOUModel`` symbol; if neither exists we proceed
    WITHOUT a turn detector (VAD-only) and log a warning rather than crash.
"""

from __future__ import annotations

import asyncio
import contextlib

from stewardai.common.audio import SAMPLE_RATE
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings
from stewardai.factory import make_llm, make_stt, make_tts

_log = get_logger("agent.assembly")

_DEFAULT_INSTRUCTIONS = (
    "You are a helpful voice assistant speaking with a person out loud. Your "
    "replies are read aloud by a text-to-speech engine, so follow these rules:\n"
    "- Speak in plain, natural sentences. Never use markdown, lists, headings, "
    "emojis, or code blocks — they sound wrong when spoken.\n"
    "- Be concise and direct. Answer in one or two sentences unless more is "
    "asked for, and don't pad with filler.\n"
    "- Say numbers, dates, and times the way a person would speak them, and "
    "don't read out long URLs, IDs, or raw code unless explicitly asked.\n"
    "- If a request is ambiguous, ask one short clarifying question instead of "
    "guessing.\n"
    "- If you can't do something, or an action fails, say so once, briefly, and "
    "offer an alternative or ask how to proceed."
)

def _load_vad(s: Settings):
    """Local Silero VAD via the current inference API.

    activation_threshold / min_speech_duration come from settings so a far-field,
    noisy room can require louder/longer speech before it counts (reducing
    background-speech false triggers that the English STT then hallucinates).
    (``livekit.plugins.silero`` is deprecated in 1.6.x; ``inference.VAD`` runs the
    bundled Silero model locally — no LiveKit Cloud.)
    """
    from livekit.agents import inference  # type: ignore

    return inference.VAD(
        model="silero",
        activation_threshold=s.vad_activation_threshold,
        min_speech_duration=s.vad_min_speech_duration,
    )


def _load_turn_detector():
    """Audio Turn Detector v1.0. Returns ``None`` if unavailable (VAD-only).

    ``version="v1-mini"`` is the small model intended to run locally on CPU;
    ``version="v1"`` is the larger model served via LiveKit Inference (hosted).
    (Replaces the deprecated ``livekit.plugins.turn_detector``.)
    """
    try:
        from livekit.agents import inference  # type: ignore

        return inference.TurnDetector(version="v1-mini")
    except Exception as exc:  # noqa: BLE001
        _log.warning("turn_detector_unavailable", error=str(exc))
        return None


def _load_deepgram_stt(s: Settings, *, keyterms: tuple[str, ...] = ()):
    """Cloud STT via Deepgram (native LiveKit plugin): streaming, runs on YOUR
    Deepgram account (DEEPGRAM_API_KEY) — no local CPU, not LiveKit Cloud. Matched
    to 16 kHz (the bot tees meeting audio at 16 kHz).

    ``keyterms`` (nova-3 only) bias recognition toward the agent's wake name and
    domain/participant terms so the combined transcript that drives decide() hears
    the wake name instead of a soundalike ("Stuart"/"Steve Ward")."""
    from livekit.plugins import deepgram  # type: ignore  # lazy

    # IMPORTANT: do NOT set endpointing_ms / interim_results here. This STT feeds the
    # AgentSession turn detector, which owns end-of-turn timing (via turn_min_delay).
    # Forcing a long Deepgram endpointing makes it wait for real silence before
    # finalizing — with continuous room noise it may never finalize, so the turn
    # hangs and the transcript arrives minutes late (or only when you speak again).
    # Let Deepgram finalize fast; group finals into whole turns via turn_min_delay.
    kwargs: dict = {"model": s.deepgram_model, "sample_rate": SAMPLE_RATE}
    if s.deepgram_api_key:
        kwargs["api_key"] = s.deepgram_api_key
    if keyterms:
        kwargs["keyterm"] = list(keyterms)
    _log.info("stt_cloud_deepgram", model=s.deepgram_model, keyterms=len(keyterms))
    return deepgram.STT(**kwargs)


def make_deepgram_speaker_stt(s: Settings, keyterms: list[str]):
    """A Deepgram nova-3 STREAMING STT for per-speaker transcription, keyterm-boosted.

    Separate from ``_load_deepgram_stt`` (the AgentSession's STT): this is used to
    open one streaming connection per speaker for the attributed transcript. nova-3
    is required for ``keyterm`` boosting (names + "Steward").
    """
    from livekit.plugins import deepgram  # type: ignore  # lazy

    kwargs: dict = {
        "model": "nova-3",
        "sample_rate": SAMPLE_RATE,
        "interim_results": True,
        # Silence before finalizing a line — the STT segmentation knob (NOT the
        # AgentSession turn detector, which is a different path). Default 500ms
        # groups words into sentences instead of the 25ms-default fragments.
        "endpointing_ms": s.stt_endpointing_ms,
    }
    if s.deepgram_api_key:
        kwargs["api_key"] = s.deepgram_api_key
    if keyterms:
        kwargs["keyterm"] = keyterms
    return deepgram.STT(**kwargs)


def _load_deepgram_tts(s: Settings):
    """Cloud TTS via Deepgram Aura (native LiveKit plugin): SAME Deepgram account/key
    as STT, so speech-to-text and text-to-speech bill against one Deepgram balance.
    16 kHz to match the Vexa bot's playback rate."""
    from livekit.plugins import deepgram  # type: ignore  # lazy

    kwargs: dict = {"model": s.deepgram_tts_model, "sample_rate": SAMPLE_RATE}
    if s.deepgram_api_key:
        kwargs["api_key"] = s.deepgram_api_key
    _log.info("tts_cloud_deepgram_aura", model=s.deepgram_tts_model)
    return deepgram.TTS(**kwargs)


def _load_cartesia_tts(s: Settings):
    """Cloud TTS via Cartesia (native LiveKit plugin): runs on YOUR Cartesia
    account (CARTESIA_API_KEY) — no local CPU. Forced to 16 kHz to match the Vexa
    bot's startPCMStream playback rate (else the reply is pitch-shifted)."""
    from livekit.plugins import cartesia  # type: ignore  # lazy

    kwargs: dict = {"model": s.cartesia_model, "sample_rate": SAMPLE_RATE}
    if s.cartesia_api_key:
        kwargs["api_key"] = s.cartesia_api_key
    if s.cartesia_voice:
        kwargs["voice"] = s.cartesia_voice
    _log.info("tts_cloud_cartesia", model=s.cartesia_model, voice=s.cartesia_voice or "default")
    return cartesia.TTS(**kwargs)


def build_session(
    settings: Settings | None = None,
    *,
    stt_backend=None,  # noqa: ANN001 - optional pre-built STTBackend to reuse
    llm_backend=None,  # noqa: ANN001 - optional pre-built LLMBackend to reuse
    tts_backend=None,  # noqa: ANN001 - optional pre-built TTSBackend to reuse
    gated: bool = False,
    native_tools: bool = False,
    system: str | None = None,
    keyterms: tuple[str, ...] | list[str] = (),
    action_tools=None,  # noqa: ANN001 - OpenAI-format Composio schemas for live actions
    tool_executor=None,  # noqa: ANN001 - async (slug, args) -> result dict
):
    """Construct a roomless ``AgentSession`` wired with our nodes + VAD + turn det.

    Pass ``stt_backend`` / ``llm_backend`` / ``tts_backend`` to reuse already-built
    backends (so heavy models load ONCE and are shared across sessions, e.g. one
    per browser connection on the web test page) instead of constructing fresh
    ones via the factory.

    Returns the ``AgentSession``. I/O is NOT attached here (no room, no
    input/output) — callers (``run_agent`` or tests) bind ``session.input.audio``
    / ``session.output.audio`` and call ``session.start``.

    Raises ``ImportError`` (lazily) if the livekit extra is not installed.
    """
    s = settings or get_settings()

    from livekit.agents import AgentSession  # type: ignore

    from stewardai.agent.nodes import build_llm_node, build_stt_node, build_tts_node

    # STT: cloud (Deepgram, native plugin — no local CPU) or our local wrapped backend.
    # keyterms boost the agent's wake name + participant/domain terms so the combined
    # STT (which drives decide) actually hears them (e.g. the wake name, not "Stuart").
    if s.stt_backend == "deepgram":
        stt = _load_deepgram_stt(s, keyterms=tuple(keyterms))
    else:
        stt = build_stt_node(
            stt_backend if stt_backend is not None else make_stt(s))
    _llm_backend = llm_backend if llm_backend is not None else make_llm(s)
    if native_tools:
        # Native meeting path: LiveKit owns the speak→tool→speak loop; the agent's
        # registered tools (Composio actions + stay_silent gate) are executed by the
        # framework. No hand-rolled decide/executor here.
        llm = build_llm_node(
            _llm_backend, system=system or _MEETING_SYSTEM, native_tools=True
        )
    elif gated:
        llm = build_llm_node(
            _llm_backend,
            system=system or _MEETING_SYSTEM,
            gated=True,
            action_tools=action_tools,
            tool_executor=tool_executor,
        )
    else:
        llm = build_llm_node(_llm_backend)
    # TTS: cloud (Cartesia or Deepgram Aura, native plugins — no local CPU) or local.
    if s.tts_backend == "cartesia":
        tts = _load_cartesia_tts(s)
    elif s.tts_backend == "deepgram":
        tts = _load_deepgram_tts(s)
    else:
        tts = build_tts_node(
            tts_backend if tts_backend is not None else make_tts(s),
            voice=s.tts_default_voice,
        )
    vad = _load_vad(s)
    turn_detection = _load_turn_detector()

    # Endpointing is LiveKit's OWN config (not custom turn logic): min_delay must
    # exceed STT latency so the linguistic/backchannel EOU check runs BEFORE the
    # audio turn detector flushes the turn — otherwise turns fire on pauses and
    # backchannels (the "eou detection ran after the audio eot turn was already
    # flushed" warning). Tune via settings.turn_min_delay / turn_max_delay.
    turn_handling: dict = {
        "endpointing": {"min_delay": s.turn_min_delay, "max_delay": s.turn_max_delay},
        "interruption": {
            "min_words": s.interruption_min_words,
            "resume_false_interruption": s.resume_false_interruption,
            "mode": s.interruption_mode,
            "min_duration": s.interruption_min_duration,
        },
    }
    if turn_detection is not None:
        turn_handling["turn_detection"] = turn_detection

    kwargs: dict = {
        "vad": vad,
        "stt": stt,
        "llm": llm,
        "tts": tts,
        "turn_handling": turn_handling,
    }
    # decide() needs the COMMITTED turn, not partials — AND our
    # on_user_turn_completed relabels the message with the speaker name, which
    # changes the chat context after any speculative generation. If preemptive
    # generation is on, LiveKit warns "preemptive generation enabled but chat
    # context ... changed" and can speak a reply built for the PREVIOUS/partial
    # turn ("answers the last question"). Force it OFF explicitly for gated
    # meetings — do NOT rely on the LiveKit default, which generates speculatively.
    if gated or native_tools:
        kwargs["preemptive_generation"] = False
    elif s.preemptive_generation:
        kwargs["preemptive_generation"] = True

    session = AgentSession(**kwargs)
    # Expose the TTS plugin so the runner can warm its connection at session start
    # (streaming TTS opens its websocket lazily — a cold first synth costs ~12s).
    with contextlib.suppress(Exception):
        session._steward_tts = tts
    _log.info(
        "session_built",
        stt=make_stt_name(stt),
        llm=make_llm_name(llm),
        tts=make_tts_name(tts),
        turn_detector=turn_detection is not None,
        min_delay=s.turn_min_delay,
        max_delay=s.turn_max_delay,
        vad_threshold=s.vad_activation_threshold,
        interruption_min_words=s.interruption_min_words,
        preemptive_generation=s.preemptive_generation,
    )
    return session


def make_stt_name(node) -> str:  # noqa: ANN001
    return getattr(getattr(node, "_inner", None), "name", "unknown")


def make_llm_name(node) -> str:  # noqa: ANN001
    return getattr(getattr(node, "_inner", None), "name", "unknown")


def make_tts_name(node) -> str:  # noqa: ANN001
    return getattr(getattr(node, "_inner", None), "name", "unknown")


def label_text(tracker, text: str) -> str:  # noqa: ANN001 - SpeakerTracker (duck-typed)
    name = tracker.current_speaker() if tracker is not None else None
    return f"[{name}]: {text}" if name else f"[Speaker]: {text}"


# Tool-availability notes appended to the meeting system prompt. {name} is the
# agent's configured display name (the owner's bot_name) — NOT hardcoded "Steward".
_TOOLS_AVAILABLE_NOTE = (
    "\n\nYou also have access to external tools (e.g. Gmail, Google Calendar, "
    "Notion, Slack). Use them ONLY when someone in the meeting directly addresses "
    "you by name (e.g. '{name}, send…', '{name}, schedule…'). "
    "NEVER call a tool on ambient conversation or when someone is not speaking to you.\n"
    "- Before calling a tool you MUST have every required detail FROM THE USER — e.g. "
    "the exact recipient email address, subject, and body for an email; the title, "
    "date and time for a calendar event. If any required detail is missing, ASK the "
    "user for it and WAIT for their answer. NEVER invent, guess, or use placeholder "
    "values (e.g. 'test', 'test@example.com', 'recipient@example.com', "
    "'[Recipient Name]') — a tool call with made-up details is never acceptable.\n"
    "- For high-risk actions (sending an email, posting to Slack), first read back "
    "what you're about to do and confirm verbally: say something like 'Want me to go "
    "ahead and send that?' and wait for a yes before executing."
)
# Appended when NO tools are registered (Composio off, or blocked at setup). Stops
# the agent from cheerfully claiming it's "checking your calendar" with no real tool.
_NO_TOOLS_NOTE = (
    "\n\nYou do NOT currently have access to any external tools (calendar, email, "
    "Slack, etc.). If someone asks you to perform such an action (e.g. 'check my "
    "calendar', 'send an email'), briefly tell them you can't do that right now — "
    "do NOT say you are doing it, checking, or looking it up, and never imply an "
    "action is in progress that you cannot actually perform."
)


def build_meeting_system(
    name: str = "Steward",
    *,
    tools_available: bool = False,
    spoken_languages: str = "English",
    today: str | None = None,
) -> str:
    """The meeting system prompt, using the agent's DISPLAY NAME (owner's bot_name)
    as its identity + wake word — not a hardcoded "Steward" — and a tool note that
    matches whether external tools actually loaded.

    ``spoken_languages`` = the language(s) the TTS voice can actually SPEAK, so the
    model never replies in a language it can't be heard in. Update it when the TTS
    backend changes (kokoro → "English"; Indic Parler-TTS → "English, Urdu, or Hindi").

    ``today`` = a human-readable current date/time in the owner's timezone (e.g.
    "Friday, July 03, 2026, 2:41 PM PKT"). When set, the prompt anchors every
    time-relative request to it — without this the model has NO date reference and
    resolves "today"/"tomorrow" to its training prior (it scheduled events in 2024).
    """
    base = (
        f"You are {name}, an assistant participating in a live multi-person meeting. "
        "You receive a running transcript where each line is prefixed with the "
        "speaker's name in brackets, e.g. '[Anique]: ...'. On each turn decide whether "
        "to speak.\n"
        f'- If someone addresses you by name ("{name}") or clearly directs a question '
        "at you, you MUST speak and answer them. ALWAYS reply to something said "
        "directly to you — even if it repeats an earlier question, or you already "
        "answered something similar, or it is just a check like \"can you hear me?\". "
        "A person talking to you by name expects a response every time.\n"
        "- Also speak if you notice a MATERIAL discrepancy: something just said "
        "contradicts a decision or fact stated earlier in THIS meeting. Name both "
        'sides (e.g. "Earlier Anique said Friday, but Sarah just said Monday — which '
        'is it?").\n'
        "- Otherwise call stay_silent: ambient discussion, people talking to EACH "
        "OTHER (not to you), small talk, agreement, or minor wording differences. "
        "Silence is the default only for talk that is NOT directed at you.\n"
        "- You are a capable, friendly assistant: beyond meeting facts you can answer "
        "general questions, explain, brainstorm, reason, or tell a short story when "
        "asked. NEVER refuse a reasonable request by claiming you can only manage "
        "meetings or tools — if you can answer, just answer.\n"
        "- Keep replies short by default (one or two sentences), but when someone "
        "explicitly asks for something longer — a story, a summary, an explanation — "
        "give a fuller answer.\n"
        "- If someone just tells you to stop, pause, wait, or hold on, stop talking "
        "and stay silent; do not start a new reply or explain yourself.\n"
        f"- Your text-to-speech voice can only speak {spoken_languages}. Reply in "
        f"{spoken_languages}, matching the language the person used when it is one of "
        f"these. If they use a language your voice cannot produce, understand them but "
        f"answer in {spoken_languages} and briefly say that is the only language you "
        "can speak aloud.\n"
        "- You can see the ENTIRE conversation above and it is your memory of this "
        "meeting — ALWAYS use it. NEVER say you don't remember, can't recall, or lack "
        "memory of previous turns; you have the full transcript right here.\n"
        "- Do NOT re-ask for something the speaker already told you. The transcript "
        "may be imperfect (speech-to-text errors, split or repeated lines) — piece "
        "together what they meant from context and use the details already given "
        "instead of asking again.\n"
        "- Never read the bracketed name prefixes aloud; they are only for your context."
    )
    if today:
        base += (
            f"\n- IMPORTANT — Today's date is {today}. Resolve EVERY time-relative "
            'request ("today", "tonight", "tomorrow", "this Friday", "next Monday", '
            '"in an hour") from this exact date and time. NEVER assume a different '
            "year or date, and if someone asks what day or date it is, answer from this."
        )
    note = _TOOLS_AVAILABLE_NOTE if tools_available else _NO_TOOLS_NOTE
    return base + note.format(name=name)


# Default prompt (name "Steward", no tools) for callers that don't pass one
# (the ungated /pipeline demo, tests). Real meetings pass a name-specific prompt.
_MEETING_SYSTEM = build_meeting_system()


def build_meeting_agent(  # noqa: ANN001
    settings=None,
    *,
    tracker=None,
    transcript=None,
    on_summarize=None,
    transcript_path=None,
    on_line=None,
    live_tools=None,
    instructions=None,
    user_id: str | None = None,
):
    """Agent that labels each finalized user turn with the active speaker and
    records it to ``transcript`` (a list[str]) for later summarization.

    When a turn explicitly asks Steward to summarize, fires ``on_summarize()`` (the
    runner writes the artifact from the transcript-so-far). This command trigger is
    the reliable one — shutdown-time generation does not survive signal/async
    cancellation.

    When ``transcript_path`` is set, each labeled turn is ALSO appended to that file
    as it arrives, so the full raw transcript is persisted turn-by-turn and survives
    a stop/crash (the summary alone is not the transcript).

    When ``on_line`` is provided, it is called with each finalized labeled line
    ("[Speaker]: text") as it arrives — the runner uses this to persist the combined
    (reliable) transcript to the portal live. It must be cheap/non-blocking (the
    runner schedules the actual write); it runs on the turn hot path.

    When ``live_tools`` is provided (a list of LiveKit FunctionTool callables built by
    ``build_live_tool_functions``), they are registered on the agent so the LLM can
    call Composio actions mid-meeting.

    ``instructions`` is the system prompt (built by ``build_meeting_system`` with the
    agent's display name + tool-availability note). If omitted, a default is derived
    from ``live_tools`` so the agent still knows whether it can act."""
    from livekit.agents import Agent  # type: ignore

    from stewardai.agent.summary import append_transcript_line

    if instructions is None:
        instructions = build_meeting_system(tools_available=bool(live_tools))

    class MeetingAgent(Agent):  # type: ignore[misc, valid-type]
        def __init__(self) -> None:
            tools_arg = live_tools or []
            super().__init__(instructions=instructions, tools=tools_arg)
            self._tracker = tracker
            self._transcript = transcript if transcript is not None else []
            self._on_summarize = on_summarize
            self._transcript_path = transcript_path
            self._on_line = on_line

        async def on_user_turn_completed(self, turn_ctx, new_message) -> None:  # noqa: ANN001
            # Prepend the active speaker's name so the decide LLM sees "[Name]: ..."
            raw = getattr(new_message, "text_content", None) or ""
            if raw:
                labeled = label_text(self._tracker, raw)
                with contextlib.suppress(Exception):
                    new_message.content = [labeled]
                self._transcript.append(labeled)
                # Persist each turn immediately (crash-safe full transcript on disk).
                if self._transcript_path:
                    with contextlib.suppress(Exception):
                        append_transcript_line(self._transcript_path, labeled)
                # Live portal persistence rides this reliable combined transcript.
                if self._on_line is not None:
                    with contextlib.suppress(Exception):
                        self._on_line(labeled)
                # Explicit "summarize" request -> write the artifact now (transcript is
                # complete through this turn). v1 heuristic: substring match.
                if self._on_summarize is not None and "summariz" in raw.lower():
                    self._on_summarize()

    return MeetingAgent()


def build_agent(settings: Settings | None = None):
    """Build the ``Agent`` persona handed to ``session.start`` (lazy livekit)."""
    from livekit.agents import Agent  # type: ignore

    return Agent(instructions=_DEFAULT_INSTRUCTIONS)


async def run_agent(settings: Settings | None = None) -> None:
    """Run the roomless voice agent, fed by the Vexa ``SocketAudioBridge``.

    Builds the bridge + session, binds the bridge's ``PushAudioInput`` as the
    session audio input and a ``QueueAudioOutput`` as the session audio output,
    starts the bridge's socket pump and the session with no room, then plays the
    captured agent audio back into the meeting until cancelled.

    Raises ``ImportError`` (lazily) if the livekit extra is not installed.
    """
    s = settings or get_settings()

    from stewardai.bridge.audio_input import SocketAudioBridge
    from stewardai.bridge.audio_output import QueueAudioOutput

    bridge = SocketAudioBridge(s)
    session = build_session(s)
    agent = build_agent(s)

    output = QueueAudioOutput(label="vexa")

    # Bind roomless I/O: inbound meeting audio in, agent audio out.
    session.input.audio = bridge.audio_input
    session.output.audio = output

    # Drain the agent's captured audio frames back into the meeting.
    play_task = asyncio.create_task(bridge.play(_iter_output(output)))

    _log.info("agent_starting", transport=s.bridge_transport)
    await bridge.start_pump()
    # Roomless start: no `room=` argument.
    await session.start(agent=agent)
    _log.info("agent_started")

    try:
        # Run until cancelled (the session keeps processing pushed audio).
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        _log.info("agent_cancelled")
        raise
    finally:
        play_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await play_task
        with contextlib.suppress(Exception):
            await session.aclose()
        await bridge.aclose()
        _log.info("agent_stopped")


async def _iter_output(output):  # noqa: ANN001
    """Adapt QueueAudioOutput to the AsyncIterator[AudioFrame] the player wants."""
    async for frame in output:
        yield frame


if __name__ == "__main__":
    try:
        asyncio.run(run_agent())
    except KeyboardInterrupt:
        pass
