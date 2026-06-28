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

    Raises ``ImportError`` (lazily) if livekit is not installed.
    """
    from livekit.agents import llm as lk_llm  # type: ignore

    class StewardLLMStream(lk_llm.LLMStream):  # type: ignore[misc, valid-type]
        """Streams ``backend.complete`` deltas as ``ChatChunk`` events."""

        def __init__(self, llm, *, chat_ctx, tools, conn_options, inner, system, temperature, gated):  # noqa: ANN001
            super().__init__(
                llm, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options
            )
            self._inner = inner
            self._system = system
            self._temperature = temperature
            self._gated = gated

        async def _run(self) -> None:
            messages = _chat_ctx_to_messages(self._chat_ctx)
            request_id = _gen_id()
            if self._gated:
                decision = await self._inner.decide(messages, system=self._system)
                _log.info("llm_gated_decide", backend=self._inner.name, speak=decision.speak)
                if not decision.speak:
                    return  # emit no deltas -> AgentSession stays silent
                if decision.text:
                    self._event_ch.send_nowait(_make_chat_chunk(lk_llm, request_id, decision.text))
                _log.info("llm_done", backend=self._inner.name, deltas=1)
                return
            # ungated path (browser 1:1): stream complete() deltas as before
            _log.info("llm_chat", backend=self._inner.name, messages=len(messages))
            n = 0
            try:
                async for delta in self._inner.complete(
                    messages, system=self._system, temperature=self._temperature
                ):
                    if not delta:
                        continue
                    n += 1
                    self._event_ch.send_nowait(_make_chat_chunk(lk_llm, request_id, delta))
            except asyncio.CancelledError:
                # Expected on barge-in: the user started a new turn mid-generation.
                _log.info("llm_cancelled", backend=self._inner.name, deltas=n)
                raise
            except Exception as exc:  # noqa: BLE001 - surface, don't swallow
                _log.warning("llm_error", backend=self._inner.name, deltas=n, error=str(exc))
                raise
            else:
                _log.info("llm_done", backend=self._inner.name, deltas=n)

    class StewardLLM(lk_llm.LLM):  # type: ignore[misc, valid-type]
        """LLM adapter for our ``LLMBackend``."""

        def __init__(self, inner: LLMBackend, system: str | None, temperature: float, gated: bool) -> None:
            super().__init__()
            self._inner = inner
            self._system = system
            self._temperature = temperature
            self._gated = gated

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
            )

        async def aclose(self) -> None:  # type: ignore[override]
            await self._inner.aclose()

    return StewardLLM(backend, system, temperature, gated)


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
