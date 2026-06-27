"""FastAPI test pages for the StewardAI voice core.

Three browser pages exercise the components end to end with the default (stub)
backends, so the server runs with NO heavy ML deps:

* ``/tts``      — text -> WAV via ``make_tts`` (one-shot POST).
* ``/stt``      — mic -> 16 kHz PCM frames over a websocket -> ``make_stt``.
* ``/pipeline`` — mic -> STT -> LLM (streamed tokens) -> TTS (streamed audio),
  with per-stage timing surfaced back to the page.

Audio is the canonical format everywhere: PCM s16le, 16 kHz, mono, 20 ms frames.
Backends are built once at startup via the factory and stashed on ``app.state``.
"""

from __future__ import annotations

import io
from contextlib import asynccontextmanager
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from stewardai.common.audio import SAMPLE_RATE, Message, float_from_pcm
from stewardai.common.logging import TurnTimer, configure_logging, get_logger, new_turn
from stewardai.config import get_settings
from stewardai.factory import make_llm, make_stt, make_tts
from stewardai.turn.endpointer import SilenceEndpointer

STATIC_DIR = Path(__file__).parent / "static"

log = get_logger("web")


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


def _frames_to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Assemble s16le PCM bytes into a single 16 kHz mono WAV (in memory)."""
    samples = float_from_pcm(pcm)
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@app.post("/api/tts")
async def api_tts(req: TTSRequest) -> Response:
    pcm = bytearray()
    async for frame in app.state.tts.synthesize(req.text, voice=req.voice):
        pcm.extend(frame.pcm)
    wav = _frames_to_wav(bytes(pcm))
    return Response(content=wav, media_type="audio/wav")


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
            await ws.send_json(
                {
                    "type": "transcript",
                    "text": transcript.text,
                    "t_stt_ms": timer.t.get("stt"),
                }
            )
    except WebSocketDisconnect:
        return


_VOICE_SYSTEM_PROMPT = (
    "You are StewardAI, a voice assistant in a live meeting. Reply in ONE short, "
    "conversational sentence (20 words max). Plain spoken text only — no lists, no markdown, "
    "no emojis. Be direct."
)


@app.websocket("/ws/pipeline")
async def ws_pipeline(ws: WebSocket) -> None:
    """Full voice loop: capture -> STT -> LLM (stream) -> TTS (stream) over one ws."""
    await ws.accept()
    endpointer = _new_endpointer()
    stt = app.state.stt
    llm = app.state.llm
    tts = app.state.tts
    try:
        while True:
            pcm = await ws.receive_bytes()
            utterance = endpointer.feed(pcm)
            if utterance is None:
                continue

            new_turn()
            timer = TurnTimer(log)

            with timer.stage("stt"):
                transcript = await stt.transcribe(utterance)
            await ws.send_json({"type": "transcript", "text": transcript.text})

            reply_parts: list[str] = []
            first_token_marked = False
            async for delta in llm.complete(
                [Message("user", transcript.text)], system=_VOICE_SYSTEM_PROMPT
            ):
                if not first_token_marked:
                    timer.mark("llm_ttft")
                    first_token_marked = True
                reply_parts.append(delta)
                await ws.send_json({"type": "token", "text": delta})
            reply = "".join(reply_parts)

            first_audio_marked = False
            with timer.stage("tts"):
                async for frame in tts.synthesize(reply):
                    if not first_audio_marked:
                        timer.mark("tts_ttfa")
                        first_audio_marked = True
                    await ws.send_bytes(frame.pcm)

            await ws.send_json({"type": "timing", **timer.summary()})
    except WebSocketDisconnect:
        return
