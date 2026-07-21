"""Custom LiveKit Agents nodes wrapping StewardAI's STT / LLM / TTS backends.

These adapt our typed ``Protocol`` backends (``STTBackend`` / ``LLMBackend`` /
``TTSBackend``, all over ``AudioFrame`` / ``Transcript`` / ``Message``) onto the
``livekit.agents`` plugin base classes so an ``AgentSession`` can drive them:

  * ``StewardSTT``  — batch (behind-VAD) transcription of a buffered utterance.
  * ``StewardLLM``  — streams response token deltas as ``ChatChunk``s.
  * ``StewardTTS``  — streams 16 kHz mono ``rtc.AudioFrame``s.

livekit is NOT a base dependency (it lives in the ``[cpu]`` / ``[cuda]`` extra),
so EVERY livekit import is performed LAZILY inside a function/method. Importing
this module never requires livekit; constructing/using the nodes does.

--- livekit-agents v1.x APIs adapted to (assumptions; verify on the box) ---

  STT  : ``livekit.agents.stt.STT`` base.
         - ctor: ``STT(capabilities=STTCapabilities(streaming=..., interim_results=...))``
         - override: ``async def _recognize_impl(self, buffer, *, language,
           conn_options) -> SpeechEvent`` (the public ``recognize()`` flattens
           ``buffer`` to an ``rtc.AudioFrame`` and calls ``_recognize_impl``).
         - returns ``SpeechEvent(type=SpeechEventType.FINAL_TRANSCRIPT,
           alternatives=[SpeechData(language=..., text=...)])``.
         We declare ``streaming=False`` so the framework buffers behind VAD/turn
         detection and hands us one finalized utterance — matching our batch
         ``STTBackend.transcribe``.

  LLM  : ``livekit.agents.llm.LLM`` base + ``llm.LLMStream``.
         - override: ``def chat(self, *, chat_ctx, tools=None, conn_options, ...) -> LLMStream``
         - the returned ``LLMStream`` subclass implements
           ``async def _run(self) -> None`` and pushes ``ChatChunk`` objects onto
           ``self._event_ch`` (a ``utils.aio.Chan``).
         We ignore tool-calling (Phase 1) and map ``chat_ctx`` items -> our
         ``Message`` list, then stream deltas from ``LLMBackend.complete``.

  TTS  : ``livekit.agents.tts.TTS`` base + ``tts.ChunkedStream``.
         - ctor: ``TTS(capabilities=TTSCapabilities(streaming=False),
           sample_rate=16000, num_channels=1)``
         - override: ``def synthesize(self, text, *, conn_options) -> ChunkedStream``
         - the ``ChunkedStream`` subclass implements ``async def _run(self, output_emitter)``
           (v1.x ``>=1.0``): it calls ``output_emitter.initialize(...)`` then
           ``output_emitter.push(pcm_bytes)`` / ``output_emitter.flush()``.
         NOTE: the ``_run`` signature changed across 1.x. Older 1.0 builds used
         ``async def _run(self)`` pushing ``SynthesizedAudio`` onto ``self._event_ch``.
         We detect which is in play via signature introspection and support both.
"""

from __future__ import annotations

import asyncio
import contextlib
import random
import re

from stewardai.common.audio import SAMPLE_RATE, Message, Transcript
from stewardai.common.logging import get_logger
from stewardai.interfaces import LLMBackend, STTBackend, TTSBackend

_log = get_logger("agent.nodes")


# --------------------------------------------------------------------------- #
# STT node
# --------------------------------------------------------------------------- #
def build_stt_node(backend: STTBackend):
    """Return a ``livekit.agents.stt.STT`` instance wrapping ``backend``.

    Raises ``ImportError`` (lazily) if livekit is not installed.
    """
    from livekit import rtc  # type: ignore
    from livekit.agents import stt as lk_stt  # type: ignore

    class StewardSTT(lk_stt.STT):  # type: ignore[misc, valid-type]
        """Batch (behind-VAD) STT adapter for our ``STTBackend``."""

        def __init__(self, inner: STTBackend) -> None:
            super().__init__(
                capabilities=lk_stt.STTCapabilities(
                    streaming=False, interim_results=False
                )
            )
            self._inner = inner

        async def _recognize_impl(
            self,
            buffer,  # noqa: ANN001 - AudioBuffer (rtc.AudioFrame | list[rtc.AudioFrame])
            *,
            language=None,  # noqa: ANN001
            conn_options=None,  # noqa: ANN001
        ):
            pcm, sample_rate = _buffer_to_pcm(rtc, buffer)
            lang = _lang_str(language) or "en"
            transcript: Transcript = await self._inner.transcribe(
                pcm, sample_rate=sample_rate, lang=lang
            )
            _log.info(
                "stt_recognize",
                backend=self._inner.name,
                chars=len(transcript.text),
                sample_rate=sample_rate,
            )
            return lk_stt.SpeechEvent(
                type=lk_stt.SpeechEventType.FINAL_TRANSCRIPT,
                alternatives=[
                    lk_stt.SpeechData(
                        language=lang,
                        text=transcript.text,
                        confidence=transcript.confidence or 1.0,
                    )
                ],
            )

        async def aclose(self) -> None:  # type: ignore[override]
            await self._inner.aclose()

    return StewardSTT(backend)


def _buffer_to_pcm(rtc, buffer) -> tuple[bytes, int]:  # noqa: ANN001
    """Flatten a livekit ``AudioBuffer`` to (s16le bytes, sample_rate).

    ``buffer`` may be a single ``rtc.AudioFrame`` or a list of them. We
    concatenate raw little-endian int16 ``data`` and take the first frame's
    sample rate (our pipeline is mono/16 kHz throughout).
    """
    frames = buffer if isinstance(buffer, list) else [buffer]
    if not frames:
        return b"", SAMPLE_RATE
    # rtc.AudioFrame.data is a buffer of int16 samples; bytes() gives s16le.
    pcm = b"".join(bytes(f.data) for f in frames)
    sample_rate = getattr(frames[0], "sample_rate", SAMPLE_RATE) or SAMPLE_RATE
    return pcm, sample_rate


def _lang_str(language) -> str | None:  # noqa: ANN001
    """Normalize livekit's language arg (str | NotGiven | None) to a plain str."""
    if language is None:
        return None
    if isinstance(language, str):
        return language
    # NotGiven sentinel or similar — fall back to default.
    return None


# --------------------------------------------------------------------------- #
# LLM node
# --------------------------------------------------------------------------- #
def build_llm_node(
    backend: LLMBackend,
    *,
    system: str | None = None,
    temperature: float = 0.4,
    gated: bool = False,
    native_tools: bool = False,
    silent: bool = False,
    action_tools=None,  # noqa: ANN001 - OpenAI-format Composio tool schemas (gated live actions)
    tool_executor=None,  # noqa: ANN001 - async (slug, args) -> result dict
):
    """Return a ``livekit.agents.llm.LLM`` instance wrapping ``backend``.

    Args:
        backend: Our ``LLMBackend`` (must also implement ``decide`` when ``gated=True``).
        system: Optional system-prompt override.
        temperature: Sampling temperature (ungated path only).
        gated: When ``True``, each turn calls ``backend.decide()`` first.  If the
            decision is ``speak=False`` the stream emits **no deltas** so the
            ``AgentSession`` produces no speech.  When ``speak=True`` the single
            ``decision.text`` is emitted as one chunk.  When ``False`` (default,
            browser 1:1 path) the stream falls through to ``backend.complete()``
            as before — behaviour is unchanged.
        silent: When ``True`` (silent notetaker mode, ``allow_meeting_speech`` off),
            the stream's ``_run`` short-circuits and emits NOTHING — the model
            (``backend``) is NEVER invoked on any turn. The ``AgentSession`` still
            runs STT + turn detection (so the transcript is captured and persisted
            via ``on_user_turn_completed``), but there is ZERO per-turn LLM
            inference. This eliminates the per-turn model call that would otherwise
            run every turn even with the mic muted.

    Raises ``ImportError`` (lazily) if livekit is not installed.
    """
    from livekit.agents import llm as lk_llm  # type: ignore

    class StewardLLMStream(lk_llm.LLMStream):  # type: ignore[misc, valid-type]
        """Streams ``backend.complete`` deltas as ``ChatChunk`` events."""

        def __init__(  # noqa: ANN001
            self, llm, *, chat_ctx, tools, conn_options, inner, system, temperature,
            gated, native_tools, silent, action_tools, tool_executor
        ):
            super().__init__(
                llm, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options
            )
            self._steward_llm = llm  # shared plugin instance (holds the turn counter)
            self._inner = inner
            self._system = system
            self._temperature = temperature
            self._gated = gated
            self._native_tools = native_tools
            self._silent = silent
            self._tools_list = tools or []  # agent's registered tools (native path)
            self._action_tools = action_tools
            self._tool_executor = tool_executor

        async def _run(self) -> None:
            if self._silent:
                # Silent notetaker mode (profiles.allow_meeting_speech = False):
                # NEVER invoke the model. STT + turn detection still ran and the
                # transcript was already recorded/persisted by the agent's
                # on_user_turn_completed BEFORE this node is called — so notes are
                # captured, but we emit zero chunks and make ZERO per-turn LLM
                # calls (no chat_with_tools / decide / complete). This is the whole
                # point of silent mode: no in-meeting inference, not just a muted mic.
                _log.info("llm_silent_noop", backend=self._inner.name)
                return
            messages = _chat_ctx_to_messages(self._chat_ctx)
            request_id = _gen_id()
            if self._native_tools:
                # NATIVE meeting path: let LiveKit own the tool loop. We stream content
                # (spoken as it arrives) + emit tool-call chunks; the framework runs the
                # registered tools (Composio actions + stay_silent) and re-invokes chat()
                # with the results for the follow-up spoken reply. This gives correct
                # utterance boundaries (preamble spoken BEFORE the tool runs, result after)
                # and uses stay_silent(→StopResponse) as the "stay quiet" gate.
                from stewardai.agent.native_tools import (
                    chat_ctx_to_oai_messages,
                    tools_to_litellm,
                )

                items = list(getattr(self._chat_ctx, "items", None) or [])
                oai_messages = chat_ctx_to_oai_messages(items, system=self._system)
                oai_tools = tools_to_litellm(self._tools_list)
                addressed = _addressed_by_name_oai(self._system, oai_messages)
                self._steward_llm._turn_seq += 1
                my_seq = self._steward_llm._turn_seq
                # Cold-wake guard: no wake name AND not already in a conversation with
                # us -> this turn is not for us. Stay silent WITHOUT invoking the model,
                # so ambient talk / greetings between other people can never wake it.
                if not addressed and not self._steward_llm._thread_active:
                    _log.info("cold_wake_guard_silent", backend=self._inner.name)
                    return
                _last_user = next(
                    (m.get("content") for m in reversed(oai_messages)
                     if m.get("role") == "user"),
                    "",
                )
                san = _ReplySanitizer(str(_last_user or ""))
                from stewardai.agent.tool_turn import _SLOW_FILLERS
                from stewardai.config import get_settings as _get_settings

                n = 0        # total chunks emitted (text + tool_call + filler)
                spoke = 0    # spoken TEXT chunks only (real model prose)
                filler_said = False
                # Only fill on turns actually aimed at us — never blurt on ambient.
                slow_s = _get_settings().slow_reply_filler_s if addressed else 0.0

                def _say_filler() -> None:
                    nonlocal filler_said, n
                    if filler_said:
                        return
                    filler_said = True
                    self._event_ch.send_nowait(
                        _make_chat_chunk(lk_llm, request_id, random.choice(_SLOW_FILLERS))
                    )
                    n += 1

                agen = self._inner.chat_with_tools(oai_messages, tools=oai_tools)
                first = True
                try:
                    while True:
                        # SLOW-LLM filler: before any output, wait up to slow_s for the
                        # first item; if the model is slow (e.g. Gemini overloaded),
                        # speak one filler WITHOUT cancelling the pending call, then keep
                        # waiting — an overloaded turn is never dead air.
                        if first and slow_s > 0 and spoke == 0 and not filler_said:
                            task = asyncio.ensure_future(agen.__anext__())
                            done, _ = await asyncio.wait({task}, timeout=slow_s)
                            if not done:
                                _say_filler()
                            try:
                                kind, payload = await task
                            except StopAsyncIteration:
                                break
                        else:
                            try:
                                kind, payload = await agen.__anext__()
                            except StopAsyncIteration:
                                break
                        first = False
                        if self._steward_llm._turn_seq != my_seq:
                            _log.info(
                                "turn_superseded", backend=self._inner.name, deltas=n
                            )
                            return
                        if kind == "text":
                            if payload:
                                spoke += 1  # model produced prose (gates fillers/thread)
                                clean = san.feed(payload)
                                if clean:
                                    self._event_ch.send_nowait(
                                        _make_chat_chunk(lk_llm, request_id, clean)
                                    )
                                    n += 1
                        elif kind == "tool_call":
                            # TOOL-CALL filler: a real tool is about to run — cover its
                            # latency with a filler if we've said nothing yet. stay_silent
                            # means "say nothing", so it never gets a filler.
                            tool_name = (
                                payload.get("name") if isinstance(payload, dict) else None
                            )
                            if tool_name != "stay_silent" and spoke == 0 and not filler_said:
                                _say_filler()
                            self._event_ch.send_nowait(
                                _make_tool_call_chunk(lk_llm, request_id, payload)
                            )
                            n += 1
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - a transient LLM failure must
                    # not wedge the session; stay quiet (or apologize if addressed).
                    _log.warning(
                        "llm_native_failed", backend=self._inner.name, error=str(exc)
                    )
                    if addressed and n == 0:
                        self._event_ch.send_nowait(
                            _make_chat_chunk(lk_llm, request_id, _LLM_ERROR_FALLBACK)
                        )
                        _log.info("llm_error_fallback_spoken", backend=self._inner.name)
                    return
                finally:
                    with contextlib.suppress(Exception):
                        await agen.aclose()
                # Flush any buffered head (a short reply the sanitizer held back).
                tail = san.flush()
                if tail:
                    self._event_ch.send_nowait(
                        _make_chat_chunk(lk_llm, request_id, tail)
                    )
                    n += 1
                # Thread opens when we spoke, closes when we stayed silent: a name-less
                # follow-up only continues an exchange we're already in.
                self._steward_llm._thread_active = spoke > 0
                _log.info("llm_native_done", backend=self._inner.name, deltas=n)
                return
            if self._gated:
                from stewardai.agent.tool_turn import resolve_turn

                deltas = 0
                # Was the bot directly addressed this turn? Used for the LLM-error
                # fallback AND to gate the slow-reply filler (never blurt on ambient).
                addressed = _addressed_by_name(self._system, messages)
                # Supersede guard: stamp this turn. If a NEWER user turn starts (bumps
                # the shared counter), stop emitting — a slow/late reply is never spoken
                # after the user has already moved on.
                self._steward_llm._turn_seq += 1
                my_seq = self._steward_llm._turn_seq
                from stewardai.config import get_settings

                slow_filler_s = get_settings().slow_reply_filler_s if addressed else 0.0
                try:
                    # Gate + (optionally) run a live Composio action. Streams chunks: a
                    # short "one moment" ack for a tool run, or a disfluent filler if the
                    # model is slow — so a tool/overloaded turn is never dead air.
                    async for chunk in resolve_turn(
                        self._inner,
                        messages,
                        system=self._system,
                        action_tools=self._action_tools,
                        executor=self._tool_executor,
                        slow_filler_s=slow_filler_s,
                    ):
                        if self._steward_llm._turn_seq != my_seq:
                            # A newer turn began — this reply is stale; drop it.
                            _log.info(
                                "turn_superseded", backend=self._inner.name, deltas=deltas
                            )
                            return
                        if chunk:
                            self._event_ch.send_nowait(
                                _make_chat_chunk(lk_llm, request_id, chunk)
                            )
                            deltas += 1
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - a transient LLM failure must
                    # NOT wedge the session. If decide()/action raises (e.g. a Gemini
                    # connection blip surfaced as litellm.Timeout), an uncaught exception
                    # here leaves the AgentSession stuck ("speech scheduling is paused"),
                    # which skips all further user input and FREEZES the transcript.
                    # Swallow it: stay silent this turn so the turn completes cleanly.
                    _log.warning(
                        "llm_gated_decide_failed",
                        backend=self._inner.name,
                        error=str(exc),
                    )
                    # If the bot was clearly addressed and nothing was spoken yet, say a
                    # short apology aloud instead of silence — so a language-model outage
                    # is audible, not confusing. Stay silent on ambient turns to avoid
                    # blurting errors over normal conversation.
                    if addressed and deltas == 0:
                        self._event_ch.send_nowait(
                            _make_chat_chunk(lk_llm, request_id, _LLM_ERROR_FALLBACK)
                        )
                        _log.info("llm_error_fallback_spoken", backend=self._inner.name)
                    return
                if deltas:
                    _log.info("llm_done", backend=self._inner.name, deltas=deltas)
                return
            # ungated path (browser 1:1 / generic voice agent): stream complete() deltas
            # WITH the same accuracy/UX wiring as the gated meeting agent — slow-reply
            # filler, supersede guard, and LLM-error fallback (minus tool-calling/gating).
            from stewardai.agent.tool_turn import stream_with_slow_filler
            from stewardai.config import get_settings

            _log.info("llm_chat", backend=self._inner.name, messages=len(messages))
            # Supersede guard: stamp this turn; stop emitting if a newer turn starts, so a
            # slow/late reply is never spoken after the user has moved on.
            self._steward_llm._turn_seq += 1
            my_seq = self._steward_llm._turn_seq
            # 1:1 voice: every user turn is directed at the agent, so always enable filler.
            slow_filler_s = get_settings().slow_reply_filler_s
            n = 0
            try:
                async for delta in stream_with_slow_filler(
                    self._inner.complete(
                        messages, system=self._system, temperature=self._temperature
                    ),
                    slow_filler_s=slow_filler_s,
                ):
                    if self._steward_llm._turn_seq != my_seq:
                        _log.info("turn_superseded", backend=self._inner.name, deltas=n)
                        return
                    if not delta:
                        continue
                    n += 1
                    self._event_ch.send_nowait(_make_chat_chunk(lk_llm, request_id, delta))
            except asyncio.CancelledError:
                # Expected on barge-in: the user started a new turn mid-generation.
                _log.info("llm_cancelled", backend=self._inner.name, deltas=n)
                raise
            except Exception as exc:  # noqa: BLE001 - speak a fallback, don't wedge/silent
                _log.warning("llm_error", backend=self._inner.name, deltas=n, error=str(exc))
                if n == 0:
                    self._event_ch.send_nowait(
                        _make_chat_chunk(lk_llm, request_id, _LLM_ERROR_FALLBACK)
                    )
                    _log.info("llm_error_fallback_spoken", backend=self._inner.name)
                return
            else:
                _log.info("llm_done", backend=self._inner.name, deltas=n)

    class StewardLLM(lk_llm.LLM):  # type: ignore[misc, valid-type]
        """LLM adapter for our ``LLMBackend``."""

        def __init__(
            self, inner: LLMBackend, system: str | None, temperature: float, gated: bool,
            native_tools: bool = False, silent: bool = False,
            action_tools=None, tool_executor=None,  # noqa: ANN001
        ) -> None:
            super().__init__()
            self._inner = inner
            self._system = system
            self._temperature = temperature
            self._gated = gated
            self._native_tools = native_tools
            self._silent = silent
            self._action_tools = action_tools
            self._tool_executor = tool_executor
            # Monotonic per-session turn counter; each turn's stream stamps itself and
            # stops emitting if a newer turn bumps this (supersede guard).
            self._turn_seq = 0
            # Cold-wake guard state (native meeting path): True while the bot is in an
            # active conversation. A turn with no wake name and no active thread is
            # "cold" — the bot stays silent WITHOUT invoking the model. The thread
            # opens when the bot speaks and closes the moment it stays silent, so a
            # name-less follow-up only continues an exchange the bot is already in.
            self._thread_active = False

        def chat(
            self,
            *,
            chat_ctx,  # noqa: ANN001
            tools=None,  # noqa: ANN001
            conn_options=None,  # noqa: ANN001
            parallel_tool_calls=None,  # noqa: ANN001 - accepted+ignored (Phase 1: no tools)
            tool_choice=None,  # noqa: ANN001
            extra_kwargs=None,  # noqa: ANN001
        ):
            from livekit.agents.types import (  # type: ignore
                DEFAULT_API_CONNECT_OPTIONS,
            )

            return StewardLLMStream(
                self,
                chat_ctx=chat_ctx,
                tools=tools,
                conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
                inner=self._inner,
                system=self._system,
                temperature=self._temperature,
                gated=self._gated,
                native_tools=self._native_tools,
                silent=self._silent,
                action_tools=self._action_tools,
                tool_executor=self._tool_executor,
            )

        async def aclose(self) -> None:  # type: ignore[override]
            await self._inner.aclose()

    return StewardLLM(
        backend, system, temperature, gated, native_tools, silent,
        action_tools, tool_executor,
    )


# Spoken when the LLM API fails on a turn the bot was directly addressed on, so a
# language-model outage produces a clear apology instead of confusing dead air.
_LLM_ERROR_FALLBACK = "Sorry, I'm having trouble reaching my language model right now."

# A bracketed speaker label the model may leak into its spoken reply, e.g. "[StewardAI]: ".
_LABEL_RE = re.compile(r"\[[^\]\n]{1,60}\]:\s*")


class _ReplySanitizer:
    """Strip transcript-echo artifacts from the model's spoken text.

    The gating model sometimes CONTINUES the bracketed transcript format instead of
    just replying — it echoes the last line(s) and prefixes its answer with a '[Name]:'
    label (observed: "Hello, how are you? [StewardAI]: I'm doing well…"), which TTS then
    speaks aloud. To avoid adding latency to NORMAL replies, the head is buffered only
    while it looks like an echo (it begins by reproducing the user's last utterance, or
    with a '[Name]:' label); a normal reply is released immediately. When a '[Name]:'
    label appears in the head, everything up to and including the LAST one is echoed
    preamble and is dropped. Inline '[Name]:' labels are always stripped. The tail
    streams unchanged."""

    _HEAD_CAP = 400  # give up buffering after this (release what we have)

    def __init__(self, last_user: str = "") -> None:
        self._probe = _LABEL_RE.sub("", last_user or "").strip().lower()[:18]
        self._buf = ""
        self._head_done = False

    def feed(self, text: str) -> str:
        if self._head_done:
            return _LABEL_RE.sub("", text)
        self._buf += text
        last = None
        for last in _LABEL_RE.finditer(self._buf):
            pass
        if last is not None:  # echoed preamble + label -> keep only what follows it
            out = self._buf[last.end() :]
            self._buf = ""
            self._head_done = True
            return out
        head = self._buf.lstrip().lower()
        looks_echo = bool(self._probe) and head.startswith(self._probe[: len(head)])
        # A normal reply (doesn't start by echoing the user, no label) — release now,
        # no buffering latency. Only keep buffering while an echo still looks possible.
        if not looks_echo or len(self._buf) >= self._HEAD_CAP:
            out, self._buf, self._head_done = self._buf, "", True
            return out
        return ""

    def flush(self) -> str:
        out = _LABEL_RE.sub("", self._buf) if self._buf else ""
        self._buf = ""
        self._head_done = True
        return out


def _name_in(system, text) -> bool:  # noqa: ANN001
    """True if the bot's wake name (parsed from the 'You are {name},' system prompt)
    appears in ``text``."""
    import re

    if not system:
        return False
    m = re.match(r"You are (.+?),", system)
    if not m:
        return False
    return m.group(1).strip().lower() in (text or "").lower()


def _addressed_by_name(system, messages) -> bool:  # noqa: ANN001
    """True if the bot was directly addressed in the most recent user message (our
    ``Message`` list form). Lets us speak an apology when the LLM fails on a directed
    turn, while staying silent on ambient turns during an outage."""
    last_user = next(
        (msg for msg in reversed(messages) if getattr(msg, "role", None) == "user"),
        None,
    )
    if last_user is None:
        return False
    return _name_in(system, str(getattr(last_user, "content", "")))


def _addressed_by_name_oai(system, oai_messages) -> bool:  # noqa: ANN001
    """``_addressed_by_name`` for OpenAI-format message dicts (native path)."""
    last_user = next(
        (m for m in reversed(oai_messages) if m.get("role") == "user"), None
    )
    if last_user is None:
        return False
    return _name_in(system, str(last_user.get("content") or ""))


def _chat_ctx_to_messages(chat_ctx) -> list[Message]:  # noqa: ANN001
    """Convert a livekit ``ChatContext`` to our ``Message`` list.

    v1.x ``ChatContext`` exposes ``.items`` (``ChatMessage`` with ``.role`` and
    ``.content``, where content is a list of str/parts). We keep text parts only
    (Phase 1 is text/audio voice, no images/tools in the LLM prompt) and skip
    non-message items (function calls/outputs).
    """
    messages: list[Message] = []
    items = getattr(chat_ctx, "items", None)
    if items is None:
        # Older API exposed ``.messages``.
        items = getattr(chat_ctx, "messages", []) or []
    for item in items:
        role = getattr(item, "role", None)
        if role not in ("system", "user", "assistant"):
            continue  # skip tool calls/outputs
        text = _content_to_text(getattr(item, "content", ""))
        if text:
            messages.append(Message(role=role, content=text))
    return messages


def _content_to_text(content) -> str:  # noqa: ANN001
    """Flatten ChatMessage content (str | list[str | part]) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            else:
                txt = getattr(part, "text", None)
                if isinstance(txt, str):
                    parts.append(txt)
        return " ".join(p for p in parts if p)
    return str(content) if content else ""


def _make_chat_chunk(lk_llm, request_id: str, delta: str):  # noqa: ANN001
    """Build a ``ChatChunk`` carrying a content delta (v1.x shape).

    v1.x: ``ChatChunk(id=..., delta=ChoiceDelta(role="assistant", content=...))``.
    """
    return lk_llm.ChatChunk(
        id=request_id,
        delta=lk_llm.ChoiceDelta(role="assistant", content=delta),
    )


def _make_tool_call_chunk(lk_llm, request_id: str, call: dict):  # noqa: ANN001
    """Build a ``ChatChunk`` carrying a function tool-call (native path).

    ``call`` = {name, arguments (json str), call_id}. The framework reads
    ``delta.tool_calls`` and dispatches the registered tool; ``call_id`` round-trips
    to the FunctionCallOutput so the result matches its call.
    """
    return lk_llm.ChatChunk(
        id=request_id,
        delta=lk_llm.ChoiceDelta(
            role="assistant",
            tool_calls=[
                lk_llm.FunctionToolCall(
                    type="function",
                    name=call["name"],
                    arguments=call["arguments"],
                    call_id=call["call_id"],
                )
            ],
        ),
    )


def _gen_id() -> str:
    import uuid

    return uuid.uuid4().hex[:16]


# --------------------------------------------------------------------------- #
# TTS node
# --------------------------------------------------------------------------- #
def build_tts_node(backend: TTSBackend, *, voice: str | None = None):
    """Return a ``livekit.agents.tts.TTS`` instance wrapping ``backend``.

    Raises ``ImportError`` (lazily) if livekit is not installed.
    """
    import inspect

    from livekit.agents import tts as lk_tts  # type: ignore

    # Detect the v1.x ChunkedStream._run signature: newer builds take an
    # ``output_emitter``; the earliest 1.0 builds pushed onto ``self._event_ch``.
    _run_sig = inspect.signature(lk_tts.ChunkedStream._run)
    _uses_emitter = "output_emitter" in _run_sig.parameters

    class StewardChunkedStream(lk_tts.ChunkedStream):  # type: ignore[misc, valid-type]
        """One synthesis request: streams our PCM frames to livekit."""

        def __init__(self, tts, input_text, conn_options, inner, voice):  # noqa: ANN001
            super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
            self._inner = inner
            self._voice = voice

        # --- newer v1.x: output_emitter-based ---
        async def _run_with_emitter(self, output_emitter) -> None:  # noqa: ANN001
            request_id = _gen_id()
            output_emitter.initialize(
                request_id=request_id,
                sample_rate=SAMPLE_RATE,
                num_channels=1,
                mime_type="audio/pcm",
            )
            nframes = 0
            async for frame in self._inner.synthesize(self._input_text, voice=self._voice):
                output_emitter.push(frame.pcm)
                nframes += 1
            output_emitter.flush()
            _log.info("tts_synthesize", backend=self._inner.name, frames=nframes, mode="emitter")

        # --- earliest v1.0: event-channel-based ---
        async def _run_legacy(self) -> None:
            from livekit import rtc  # type: ignore

            request_id = _gen_id()
            nframes = 0
            async for frame in self._inner.synthesize(self._input_text, voice=self._voice):
                samples = len(frame.pcm) // 2
                audio_frame = rtc.AudioFrame(
                    data=frame.pcm,
                    sample_rate=frame.sample_rate or SAMPLE_RATE,
                    num_channels=1,
                    samples_per_channel=samples,
                )
                self._event_ch.send_nowait(
                    lk_tts.SynthesizedAudio(request_id=request_id, frame=audio_frame)
                )
                nframes += 1
            _log.info("tts_synthesize", backend=self._inner.name, frames=nframes, mode="legacy")

        if _uses_emitter:

            async def _run(self, output_emitter) -> None:  # type: ignore[override]  # noqa: ANN001
                await self._run_with_emitter(output_emitter)

        else:

            async def _run(self) -> None:  # type: ignore[override]
                await self._run_legacy()

    class StewardTTS(lk_tts.TTS):  # type: ignore[misc, valid-type]
        """TTS adapter for our ``TTSBackend`` (16 kHz mono, non-streaming)."""

        def __init__(self, inner: TTSBackend, voice: str | None) -> None:
            super().__init__(
                capabilities=lk_tts.TTSCapabilities(streaming=False),
                sample_rate=SAMPLE_RATE,
                num_channels=1,
            )
            self._inner = inner
            self._voice = voice

        def synthesize(self, text: str, *, conn_options=None):  # noqa: ANN001
            from livekit.agents.types import (  # type: ignore
                DEFAULT_API_CONNECT_OPTIONS,
            )

            return StewardChunkedStream(
                self,
                input_text=text,
                conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
                inner=self._inner,
                voice=self._voice,
            )

        async def aclose(self) -> None:  # type: ignore[override]
            await self._inner.aclose()

    return StewardTTS(backend, voice)


async def _synthesize_filler_aware(text, *, open_stream, fillers):  # noqa: ANN001
    """Core of ``filler_aware_tts_node``, decoupled from livekit/``Agent`` for testing.

    Mirrors LiveKit's default ``tts_node`` (push text into a TTS stream, yield frames)
    but with ONE change: if the FIRST chunk is a slow-reply filler, it is synthesized on
    its OWN stream so it plays immediately, then the reply streams on a SECOND, fresh
    stream. Otherwise the whole turn streams as a single segment (unchanged behaviour).

    Why a second stream instead of a mid-stream ``flush()``: LiveKit's
    ``SynthesizeStream.push_text`` DROPS any text pushed after a ``flush()`` on the same
    instance ("multiple segments in a single instance is deprecated"), so a filler and
    the reply must be two separate streams. Without this split the filler sits in the
    sentence-tokenizer buffer until later text confirms a boundary — spoken glued onto,
    and delayed until, the first real sentence of the reply.

    Args:
        text: async iterator of text chunks (the LLM node's spoken deltas).
        open_stream: zero-arg callable returning an ``async with``-able TTS stream that
            exposes ``push_text(str)`` / ``end_input()`` and async-iterates events with a
            ``.frame`` attribute (i.e. ``TTS.stream(...)`` or a ``StreamAdapter`` stream).
        fillers: set of exact filler strings; a stripped first chunk in this set gets its
            own segment.
    """

    async def _synth(chunks):  # chunks: async iterator of str -> yields audio frames
        async with open_stream() as stream:

            async def _forward() -> None:
                async for chunk in chunks:
                    stream.push_text(chunk)
                stream.end_input()

            forward_task = asyncio.create_task(_forward())
            try:
                async for ev in stream:
                    yield ev.frame
            finally:
                forward_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await forward_task

    aiter = text.__aiter__()
    try:
        first = await aiter.__anext__()
    except StopAsyncIteration:
        return  # nothing to speak

    async def _tail():
        while True:
            try:
                yield await aiter.__anext__()
            except StopAsyncIteration:
                return

    if isinstance(first, str) and first.strip() in fillers:
        # Segment 1: the filler ALONE — synthesized and played immediately.
        async def _one():
            yield first

        async for frame in _synth(_one()):
            yield frame
        # Segment 2: the real reply (remaining deltas) on a fresh stream.
        async for frame in _synth(_tail()):
            yield frame
        return

    # No leading filler: single stream over (first + rest) — default behaviour.
    async def _all():
        yield first
        async for chunk in _tail():
            yield chunk

    async for frame in _synth(_all()):
        yield frame


async def filler_aware_tts_node(self, text, model_settings):  # noqa: ANN001
    """Drop-in override for ``Agent.tts_node`` that speaks a leading slow-reply filler as
    its OWN TTS segment (so it plays immediately, not merged with / delayed until the
    first real sentence of the reply). See ``_synthesize_filler_aware`` for the why.

    Assign as a class attribute on an ``Agent`` subclass: ``tts_node = filler_aware_tts_node``.
    Behaviour matches LiveKit's default ``tts_node`` on turns with no filler."""
    from livekit.agents import tokenize, tts as lk_tts  # type: ignore

    from stewardai.agent.tool_turn import _SLOW_FILLERS

    activity = self._get_activity_or_raise()
    if activity.tts is None:
        raise RuntimeError(
            "tts_node called but no TTS is available (audio output disabled?)."
        )
    wrapped_tts = activity.tts
    if not activity.tts.capabilities.streaming:
        wrapped_tts = lk_tts.StreamAdapter(
            tts=wrapped_tts,
            sentence_tokenizer=tokenize.blingfire.SentenceTokenizer(retain_format=True),
        )
    conn_options = activity.session.conn_options.tts_conn_options

    async for frame in _synthesize_filler_aware(
        text,
        open_stream=lambda: wrapped_tts.stream(conn_options=conn_options),
        fillers=frozenset(_SLOW_FILLERS),
    ):
        yield frame
