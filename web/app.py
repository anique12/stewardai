"""FastAPI test pages for the StewardAI voice core.

Three browser pages exercise the stack:

* ``/tts``      — text -> streamed 16 kHz PCM via ``make_tts`` (incremental playback).
* ``/stt``      — mic -> 16 kHz PCM frames over a websocket -> ``make_stt``.
* ``/pipeline`` — mic -> a REAL LiveKit ``AgentSession`` (VAD + turn detector +
  our STT/LLM/TTS nodes) -> streamed agent audio back to the page. LiveKit owns
  end-of-utterance, turn-taking and barge-in — this is the production agent path,
  driven from the browser instead of from Vexa.

``/tts`` and ``/stt`` are single-component tests and run with stub backends (no
heavy deps). ``/pipeline`` needs the livekit extra + the configured backends.

Audio is the canonical format everywhere: PCM s16le, 16 kHz, mono, 20 ms frames.
Backends are built once at startup via the factory and stashed on ``app.state``;
each ``/pipeline`` connection builds a session that REUSES those shared backends.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from stewardai.common.audio import SAMPLE_RATE
from stewardai.common.logging import TurnTimer, configure_logging, get_logger
from stewardai.config import get_settings
from stewardai.factory import make_llm, make_stt, make_tts
from stewardai.turn.endpointer import SilenceEndpointer

STATIC_DIR = Path(__file__).parent / "static"

log = get_logger("web")


async def _warmup(stt, tts) -> None:  # noqa: ANN001
    """Force the heavy local models to load at startup, not on the first turn.

    Purely a preload so a user's first utterance isn't blocked behind a cold
    model load. This does NOT touch how/when the agent listens, thinks or
    responds — LiveKit owns all of that.
    """
    import time

    t0 = time.perf_counter()
    try:
        await stt.transcribe(b"\x00\x00" * (SAMPLE_RATE // 2))  # 0.5s of silence
    except Exception as exc:  # noqa: BLE001 - warmup is best-effort
        log.warning("stt_warmup_failed", error=str(exc))
    try:
        async for _frame in tts.synthesize("ok"):
            break  # first frame is enough to trigger the model load
    except Exception as exc:  # noqa: BLE001
        log.warning("tts_warmup_failed", error=str(exc))
    log.info("warmup_done", ms=round((time.perf_counter() - t0) * 1000))


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(level=settings.log_level, fmt=settings.log_format)
    # Instantiate backends once; reuse across requests/connections.
    app.state.settings = settings
    app.state.stt = make_stt(settings)
    app.state.tts = make_tts(settings)
    app.state.llm = make_llm(settings)
    log.info(
        "web_startup",
        stt=app.state.stt.name,
        tts=app.state.tts.name,
        llm=app.state.llm.name,
    )
    await _warmup(app.state.stt, app.state.tts)
    try:
        yield
    finally:
        for backend in (app.state.stt, app.state.tts, app.state.llm):
            try:
                await backend.aclose()
            except Exception:  # pragma: no cover - best-effort shutdown
                log.warning("backend_close_failed", backend=getattr(backend, "name", "?"))


app = FastAPI(title="StewardAI test pages", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _page(name: str) -> FileResponse:
    return FileResponse(STATIC_DIR / name, media_type="text/html")


@app.get("/")
async def index() -> FileResponse:
    return _page("index.html")


@app.get("/stt")
async def stt_page() -> FileResponse:
    return _page("stt.html")


@app.get("/tts")
async def tts_page() -> FileResponse:
    return _page("tts.html")


@app.get("/pipeline")
async def pipeline_page() -> FileResponse:
    return _page("pipeline.html")


@app.get("/api/voices")
async def api_voices() -> JSONResponse:
    return JSONResponse({"voices": app.state.tts.voices})


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None


@app.post("/api/tts")
async def api_tts(req: TTSRequest) -> StreamingResponse:
    # Stream raw s16le PCM frames as the TTS produces them (per-segment), so the
    # browser can start playback before the whole utterance is synthesized.
    async def gen():
        async for frame in app.state.tts.synthesize(req.text, voice=req.voice):
            yield frame.pcm

    return StreamingResponse(gen(), media_type="application/octet-stream")


def _new_endpointer() -> SilenceEndpointer:
    return SilenceEndpointer()


@app.websocket("/ws/stt")
async def ws_stt(ws: WebSocket) -> None:
    """Receive binary 16 kHz mono s16le PCM frames; emit transcripts on EOU."""
    await ws.accept()
    endpointer = _new_endpointer()
    stt = app.state.stt
    try:
        while True:
            pcm = await ws.receive_bytes()
            utterance = endpointer.feed(pcm)
            if utterance is None:
                continue
            timer = TurnTimer(log)
            with timer.stage("stt"):
                transcript = await stt.transcribe(utterance)
            if not transcript.text.strip():
                continue  # endpointer fired on noise; STT found no words
            await ws.send_json(
                {
                    "type": "transcript",
                    "text": transcript.text,
                    "t_stt_ms": timer.t.get("stt"),
                }
            )
    except WebSocketDisconnect:
        return


async def _safe_send(ws: WebSocket, payload: dict) -> None:
    """Best-effort JSON send; the client may have gone away mid-turn."""
    with suppress(Exception):
        await ws.send_json(payload)


@app.websocket("/ws/pipeline")
async def ws_pipeline(ws: WebSocket) -> None:
    """Full voice loop driven by a real LiveKit ``AgentSession``.

    browser mic PCM -> ``session.input`` (PushAudioInput) -> LiveKit VAD + turn
    detector + our STT/LLM/TTS nodes -> ``session.output`` (QueueAudioOutput) ->
    browser. LiveKit owns end-of-utterance, turn-taking and barge-in; we only
    bridge audio in/out and forward transcript/reply text for display.
    """
    await ws.accept()
    try:
        from livekit.agents import metrics as lk_metrics

        from stewardai.agent.assembly import build_agent, build_session
        from stewardai.bridge.audio_input import _build_push_audio_input
        from stewardai.bridge.audio_output import QueueAudioOutput
    except Exception as exc:  # noqa: BLE001 - livekit extra not installed
        await _safe_send(ws, {"type": "error", "text": f"agent unavailable: {exc}"})
        await ws.close()
        return

    loop = asyncio.get_running_loop()
    s = app.state.settings
    session = None
    audio_in = None
    audio_out = None
    out_task: asyncio.Task | None = None
    try:
        # Reuse the shared, already-loaded backends — no per-connection model reload.
        session = build_session(
            s,
            stt_backend=app.state.stt,
            llm_backend=app.state.llm,
            tts_backend=app.state.tts,
        )
        agent = build_agent(s)
        audio_in = _build_push_audio_input()()
        audio_out = QueueAudioOutput(label="web")
        session.input.audio = audio_in
        session.output.audio = audio_out

        def _emit(payload: dict) -> None:
            # Session callbacks fire on the loop thread; schedule a ws send.
            loop.create_task(_safe_send(ws, payload))

        # Barge-in: LiveKit calls clear_buffer() -> tell the page to stop playback.
        audio_out.on_clear = lambda: _emit({"type": "clear"})

        def _on_transcribed(ev) -> None:  # noqa: ANN001 - UserInputTranscribedEvent
            if getattr(ev, "is_final", True):
                text = (getattr(ev, "transcript", "") or "").strip()
                if text:
                    _emit({"type": "transcript", "text": text})

        def _on_item(ev) -> None:  # noqa: ANN001 - ConversationItemAddedEvent
            item = getattr(ev, "item", None)
            if item is not None and getattr(item, "role", None) == "assistant":
                text = (getattr(item, "text_content", None) or "").strip()
                if text:
                    _emit({"type": "reply", "text": text})

        def _ms(x) -> int | None:  # noqa: ANN001 - seconds float | None -> ms int
            return round(x * 1000) if x is not None else None

        def _on_metrics(ev) -> None:  # noqa: ANN001 - MetricsCollectedEvent
            # LiveKit's OWN per-turn measurements (not hand-rolled timers).
            m = ev.metrics
            if isinstance(m, lk_metrics.EOUMetrics):
                _emit({
                    "type": "metric", "kind": "eou",
                    "eou_delay_ms": _ms(m.end_of_utterance_delay),
                    "transcription_delay_ms": _ms(m.transcription_delay),
                })
            elif isinstance(m, lk_metrics.STTMetrics):
                _emit({"type": "metric", "kind": "stt", "duration_ms": _ms(m.duration)})
            elif isinstance(m, lk_metrics.LLMMetrics):
                _emit({
                    "type": "metric", "kind": "llm",
                    "ttft_ms": _ms(m.ttft), "duration_ms": _ms(m.duration),
                })
            elif isinstance(m, lk_metrics.TTSMetrics):
                _emit({
                    "type": "metric", "kind": "tts",
                    "ttfb_ms": _ms(m.ttfb), "duration_ms": _ms(m.duration),
                })

        session.on("user_input_transcribed", _on_transcribed)
        session.on("conversation_item_added", _on_item)
        session.on("metrics_collected", _on_metrics)

        async def _pump_output() -> None:
            # paced_frames sends at ~real time (small client buffer) + reports playback,
            # so the backlog stays server-side and a barge-in drops it instantly.
            async for frame in audio_out.paced_frames():
                await ws.send_bytes(frame.pcm)

        await session.start(agent=agent)
        log.info("pipeline_agent_started")
        _emit({"type": "ready"})
        out_task = asyncio.create_task(_pump_output())

        while True:
            pcm = await ws.receive_bytes()
            audio_in.push(pcm)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 - surface setup/runtime errors to the page
        log.warning("pipeline_agent_error", error=str(exc))
        await _safe_send(ws, {"type": "error", "text": str(exc)})
    finally:
        if out_task is not None:
            out_task.cancel()
            with suppress(asyncio.CancelledError):
                await out_task
        if audio_in is not None:
            with suppress(Exception):
                audio_in.end_input()
        if audio_out is not None:
            with suppress(Exception):
                await audio_out.aclose()
        if session is not None:
            with suppress(Exception):
                await session.aclose()
        log.info("pipeline_agent_stopped")
