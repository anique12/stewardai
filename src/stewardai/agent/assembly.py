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


def _load_deepgram_stt(s: Settings):
    """Cloud STT via Deepgram (native LiveKit plugin): streaming, runs on YOUR
    Deepgram account (DEEPGRAM_API_KEY) — no local CPU, not LiveKit Cloud. Matched
    to 16 kHz (the bot tees meeting audio at 16 kHz)."""
    from livekit.plugins import deepgram  # type: ignore  # lazy

    kwargs: dict = {"model": s.deepgram_model, "sample_rate": SAMPLE_RATE}
    if s.deepgram_api_key:
        kwargs["api_key"] = s.deepgram_api_key
    _log.info("stt_cloud_deepgram", model=s.deepgram_model)
    return deepgram.STT(**kwargs)


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
    if s.stt_backend == "deepgram":
        stt = _load_deepgram_stt(s)
    else:
        stt = build_stt_node(
            stt_backend if stt_backend is not None else make_stt(s))
    _llm_backend = llm_backend if llm_backend is not None else make_llm(s)
    if gated:
        llm = build_llm_node(_llm_backend, system=_MEETING_SYSTEM, gated=True)
    else:
        llm = build_llm_node(_llm_backend)
    # TTS: cloud (Cartesia, native plugin — no local CPU) or our local wrapped backend.
    if s.tts_backend == "cartesia":
        tts = _load_cartesia_tts(s)
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
    # Only pass when enabled, so we keep LiveKit's own default (NOT_GIVEN) otherwise.
    # decide() needs the committed turn, not partials -> force preemptive off when gated.
    if s.preemptive_generation and not gated:
        kwargs["preemptive_generation"] = True

    session = AgentSession(**kwargs)
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


_MEETING_SYSTEM = (
    "You are Steward, an assistant participating in a live multi-person meeting. "
    "You receive a running transcript where each line is prefixed with the "
    "speaker's name in brackets, e.g. '[Anique]: ...'. On each turn decide whether "
    "to speak.\n"
    "- Call speak ONLY when (a) someone directly addresses you by name (\"Steward\") "
    "or clearly asks you something, OR (b) you notice a MATERIAL discrepancy: "
    "something just said contradicts a decision or fact stated earlier in THIS "
    "meeting. When flagging a discrepancy, name both sides (e.g. \"Earlier Anique "
    "said Friday, but Sarah just said Monday — which is it?\"). Keep it to one or "
    "two spoken sentences.\n"
    "- Otherwise call stay_silent. Do NOT chime in on normal discussion, agreement, "
    "small talk, or minor wording differences. Silence is the default.\n"
    "- Never read the bracketed name prefixes aloud; they are only for your context."
)


def build_meeting_agent(settings=None, *, tracker=None, transcript=None):  # noqa: ANN001
    """Agent that labels each finalized user turn with the active speaker and
    records it to ``transcript`` (a list[str]) for later summarization."""
    from livekit.agents import Agent  # type: ignore

    class MeetingAgent(Agent):  # type: ignore[misc, valid-type]
        def __init__(self) -> None:
            super().__init__(instructions=_MEETING_SYSTEM)
            self._tracker = tracker
            self._transcript = transcript if transcript is not None else []

        async def on_user_turn_completed(self, turn_ctx, new_message) -> None:  # noqa: ANN001
            # Prepend the active speaker's name so the decide LLM sees "[Name]: ..."
            raw = getattr(new_message, "text_content", None) or ""
            if raw:
                labeled = label_text(self._tracker, raw)
                with contextlib.suppress(Exception):
                    new_message.content = [labeled]
                self._transcript.append(labeled)

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
