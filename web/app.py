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
import json
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from stewardai.agent.chat.composio_tools import build_composio_tools
from stewardai.agent.chat.session import ChatSession
from stewardai.agent.chat.store import (
    append_message,
    create_thread,
    get_thread_messages,
    thread_owned,
    update_message,
)
from stewardai.agent.chat.tools import build_read_tools
from stewardai.agent.chat.write_tools import build_write_tools
from stewardai.agent.kb.ask import answer_question
from stewardai.common.audio import SAMPLE_RATE
from stewardai.common.logging import TurnTimer, configure_logging, get_logger
from stewardai.config import get_settings
from stewardai.factory import make_llm, make_stt, make_tts
from stewardai.integrations.supabase_client import create_service_client
from stewardai.llm.warmup import warmup_llm
from stewardai.turn.endpointer import SilenceEndpointer

from .demo_auth import verify_demo_token
from .kb_auth import user_id_from_bearer

STATIC_DIR = Path(__file__).parent / "static"

log = get_logger("web")

# Cloud STT/TTS (Deepgram / Cartesia) are native LiveKit plugins constructed INSIDE
# build_session for the /pipeline AgentSession path. They are NOT factory backends —
# they have no transcribe()/synthesize() Protocol and run only inside an AgentSession
# (with a LiveKit http session). So when one is selected we don't pre-build, warm, or
# expose it on the single-component /stt and /tts pages.
_CLOUD_BACKENDS = frozenset({"deepgram", "cartesia"})


def _is_cloud(backend_name: str) -> bool:
    return backend_name in _CLOUD_BACKENDS


async def _warmup(stt, tts, llm) -> None:  # noqa: ANN001
    """Force the heavy local models + the LLM connection to ready at startup.

    Purely a preload so a user's first utterance isn't blocked behind a cold
    model load (local STT/TTS) or a cold HTTP connection (the first Gemini call
    is ~5.8s cold vs ~0.56s warm). This does NOT touch how/when the agent
    listens, thinks or responds — LiveKit owns all of that. A ``None`` STT/TTS
    backend means cloud (Deepgram/Cartesia) is selected — nothing local to
    preload, so it's skipped.
    """
    import time

    t0 = time.perf_counter()
    if stt is not None:
        try:
            await stt.transcribe(b"\x00\x00" * (SAMPLE_RATE // 2))  # 0.5s of silence
        except Exception as exc:  # noqa: BLE001 - warmup is best-effort
            log.warning("stt_warmup_failed", error=str(exc))
    if tts is not None:
        try:
            async for _frame in tts.synthesize("ok"):
                break  # first frame is enough to trigger the model load
        except Exception as exc:  # noqa: BLE001
            log.warning("tts_warmup_failed", error=str(exc))
    await warmup_llm(llm)  # establish the LLM HTTP connection (best-effort, logs its own ms)
    log.info("warmup_done", ms=round((time.perf_counter() - t0) * 1000))


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(level=settings.log_level, fmt=settings.log_format)
    # Instantiate backends once; reuse across requests/connections. Cloud STT/TTS are
    # built inside build_session (the /pipeline path) and have no factory backend, so
    # leave them as None here and skip pre-build + warmup. The LLM is always ours.
    app.state.settings = settings
    app.state.stt = None if _is_cloud(settings.stt_backend) else make_stt(settings)
    app.state.tts = None if _is_cloud(settings.tts_backend) else make_tts(settings)
    app.state.llm = make_llm(settings)
    app.state.supabase = None
    try:
        app.state.supabase = await create_service_client(settings)
    except Exception as exc:  # noqa: BLE001 - Ask is optional; don't block startup
        log.warning("supabase_client_unavailable", error=str(exc))
    # Register the global litellm usage/cost callback once, reusing the service
    # client. Best-effort: if the client is unavailable, rows just aren't written.
    try:
        from stewardai.observability.usage_logger import install_usage_logger

        install_usage_logger(lambda: app.state.supabase)
    except Exception as exc:  # noqa: BLE001 - logging must never block startup
        log.warning("usage_logger_install_failed", error=str(exc))
    # Composio (Gmail/Calendar/Notion/Slack chat tools) is optional: only built
    # when COMPOSIO_API_KEY is set, and never allowed to block startup. Same
    # guarded-construction pattern as meeting_runner.run_multiplexer.
    # Process-global chat sessions keyed by thread_id, so a paused turn (waiting
    # on a permission/connect interrupt) survives a client reconnect/refresh and
    # can still be resumed against the same in-memory graph checkpoint. (Lost on
    # a process restart — that's the documented limit; the paused turn is still
    # persisted so it re-renders, and the decision then reports "expired".)
    app.state.chat_sessions = {}
    app.state.composio_service = None
    if settings.composio_enabled:
        try:
            from stewardai.integrations.composio_service import ComposioService

            app.state.composio_service = ComposioService()
        except Exception as exc:  # noqa: BLE001 - chat still works without it
            log.warning("composio_service_unavailable", error=str(exc))
    log.info(
        "web_startup",
        stt=app.state.stt.name if app.state.stt is not None else f"{settings.stt_backend} (cloud)",
        tts=app.state.tts.name if app.state.tts is not None else f"{settings.tts_backend} (cloud)",
        llm=app.state.llm.name,
    )
    await _warmup(app.state.stt, app.state.tts, app.state.llm)
    try:
        yield
    finally:
        for backend in (app.state.stt, app.state.tts, app.state.llm):
            if backend is None:
                continue
            try:
                await backend.aclose()
            except Exception:  # pragma: no cover - best-effort shutdown
                log.warning("backend_close_failed", backend=getattr(backend, "name", "?"))


app = FastAPI(title="StewardAI test pages", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_origins = [o.strip() for o in get_settings().ask_cors_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=_origins, allow_methods=["POST"],
        allow_headers=["authorization", "content-type"],
    )


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
    if app.state.tts is None:  # cloud TTS — only available via /pipeline
        return JSONResponse(
            {"voices": [], "note": f"cloud TTS ({app.state.settings.tts_backend}); use /pipeline"}
        )
    return JSONResponse({"voices": app.state.tts.voices})


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None


@app.post("/api/tts")
async def api_tts(req: TTSRequest):
    if app.state.tts is None:  # cloud TTS has no standalone synthesize() — use /pipeline
        msg = f"cloud TTS ({app.state.settings.tts_backend}) is only available via /pipeline"
        return JSONResponse({"error": msg}, status_code=503)

    # Stream raw s16le PCM frames as the TTS produces them (per-segment), so the
    # browser can start playback before the whole utterance is synthesized.
    async def gen():
        async for frame in app.state.tts.synthesize(req.text, voice=req.voice):
            yield frame.pcm

    return StreamingResponse(gen(), media_type="application/octet-stream")


class AskRequest(BaseModel):
    query: str
    space_id: str | None = None


@app.post("/api/ask")
async def api_ask(req: AskRequest, request: Request):
    if app.state.supabase is None:
        return JSONResponse({"error": "ask unavailable"}, status_code=503)
    user_id = await user_id_from_bearer(
        request.headers.get("authorization"), app.state.supabase
    )
    if not user_id:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    result = await answer_question(
        app.state.supabase, app.state.llm,
        user_id=user_id, query=req.query, space_id=req.space_id,
    )
    return JSONResponse(result)


def _new_endpointer() -> SilenceEndpointer:
    return SilenceEndpointer()


@app.websocket("/ws/stt")
async def ws_stt(ws: WebSocket) -> None:
    """Receive binary 16 kHz mono s16le PCM frames; emit transcripts on EOU."""
    await ws.accept()
    if app.state.stt is None:  # cloud STT has no standalone transcribe() — use /pipeline
        msg = f"cloud STT ({app.state.settings.stt_backend}) is only available via /pipeline"
        await _safe_send(ws, {"type": "error", "text": msg})
        await ws.close()
        return
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

    # Public demo gate: when a secret is configured, require a valid signed token and
    # cap the session. Unset = local dev, no gate. Checked before the heavy livekit
    # import so an unauthorized/expired token is rejected cheaply.
    demo_secret = app.state.settings.demo_token_secret
    if demo_secret and not verify_demo_token(ws.query_params.get("token", ""), demo_secret):
        await _safe_send(ws, {"type": "error", "text": "invalid or expired demo token"})
        with suppress(Exception):
            await ws.close(code=1008)  # policy violation
        return

    try:
        from livekit.agents import metrics as lk_metrics
        from livekit.agents.utils import http_context

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
    cap_task: asyncio.Task | None = None
    # Cloud STT/TTS plugins (deepgram/cartesia) need a LiveKit http session, which only
    # exists inside a LiveKit job; roomless we open one for this connection's lifetime
    # (entered manually so the handler body below isn't re-indented). Harmless for the
    # local backends — they don't touch it.
    http_session_cm = http_context.open()
    await http_session_cm.__aenter__()
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

        # Demo session cap: when gated, end the session gracefully after the cap so a
        # tunnelled public endpoint can't be held open indefinitely (cost/abuse).
        cap_s = app.state.settings.demo_session_cap_s
        if demo_secret and cap_s > 0:
            async def _enforce_cap() -> None:
                await asyncio.sleep(cap_s)
                await _safe_send(ws, {"type": "ended", "reason": "time_limit"})
                with suppress(Exception):
                    await ws.close(code=1000)

            cap_task = asyncio.create_task(_enforce_cap())

        while True:
            pcm = await ws.receive_bytes()
            audio_in.push(pcm)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 - surface setup/runtime errors to the page
        log.warning("pipeline_agent_error", error=str(exc))
        await _safe_send(ws, {"type": "error", "text": str(exc)})
    finally:
        if cap_task is not None:
            cap_task.cancel()
            with suppress(asyncio.CancelledError):
                await cap_task
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
        with suppress(Exception):
            await http_session_cm.__aexit__(None, None, None)
        log.info("pipeline_agent_stopped")


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket) -> None:
    """Agentic chat over a websocket: streamed token/activity events ending in
    ``done`` -- or, mid-turn, in ``permission_request``/``connect_required``
    when a write tool interrupts for a human decision -- backed by C2's
    :class:`~stewardai.agent.chat.session.ChatSession`.

    Browsers can't set headers on a websocket, so auth rides a ``?token=``
    query param instead (same Supabase-bearer resolution as ``/api/ask``).
    Threads/messages are persisted via the chat store, which is itself
    best-effort (swallows DB errors) -- the per-turn try/except below is a
    second guard so a lost store or agent error never kills the connection.

    A ``ChatSession`` is built fresh on every ``user_message`` (its full
    history is reloaded from the store each time, same as C1), but the
    interrupt/resume protocol needs the *same* session object that raised the
    interrupt, so ``sessions`` keeps the most recent session per thread_id and
    ``suspended`` remembers which thread (if any) is paused awaiting a
    ``permission_decision``/``connect_done`` from the client.
    """
    await ws.accept()

    if app.state.supabase is None:
        await _safe_send(ws, {"type": "error", "text": "chat unavailable"})
        with suppress(Exception):
            await ws.close(code=1011)  # internal error / server misconfig
        return

    token = ws.query_params.get("token", "")
    user_id = await user_id_from_bearer(f"Bearer {token}", app.state.supabase)
    if not user_id:
        await _safe_send(ws, {"type": "error", "text": "unauthorized"})
        with suppress(Exception):
            await ws.close(code=1008)  # policy violation
        return

    if getattr(app.state, "chat_sessions", None) is None:
        app.state.chat_sessions = {}  # defensive (e.g. tests that skip lifespan)
    sessions: dict[str, ChatSession] = app.state.chat_sessions
    suspended: tuple[str, str | None] | None = None

    async def _persist_assistant(session, thread_id: str, parts: list, *, final: bool) -> None:
        """Persist the assistant turn as ONE row. A paused turn is written with a
        `pending` part (so it survives refresh + re-renders its card); resuming
        updates that same row in place (final=True clears pending), so a
        pause→resume→done turn never duplicates into two rows."""
        pid = getattr(session, "_pending_row_id", None)
        if pid:
            await update_message(app.state.supabase, message_id=pid, parts=parts)
            if final:
                session._pending_row_id = None
        else:
            new_id = await append_message(
                app.state.supabase, user_id=user_id, thread_id=thread_id,
                role="assistant", parts=parts,
            )
            if not final:
                session._pending_row_id = new_id

    async def _drain(session, stream, thread_id: str) -> tuple[str, str | None] | None:
        """Forward every event from a ``stream_turn``/``resume`` stream to the
        client, accumulating text/thinking/activities so a mid-turn pause can be
        persisted. Returns a ``suspended`` marker if the turn paused on a
        permission/connect interrupt (persisting the partial turn + its pending
        card), or ``None`` if it ran to ``done`` (persisting the final turn)."""
        text = ""
        thinking = ""
        acts: dict = {}  # (kind, name) -> {kind, name, status}
        async for ev in stream:
            await ws.send_json(ev)
            et = ev.get("type")
            if et == "token":
                text += ev.get("delta", "")
            elif et == "thinking":
                thinking += ev.get("delta", "")
            elif et == "activity":
                acts[(ev.get("kind"), ev.get("name"))] = {
                    "kind": ev.get("kind"), "name": ev.get("name"), "status": ev.get("status"),
                }
            if et in ("permission_request", "connect_required"):
                kind = "permission" if et == "permission_request" else "connect"
                payload = {k: v for k, v in ev.items() if k != "type"}
                await _persist_assistant(
                    session, thread_id,
                    parts=[
                        {"type": "text", "text": text},
                        {"type": "activity_group", "activities": list(acts.values())},
                        {"type": "thinking_block", "thinking": thinking, "thinking_seconds": None},
                        {"type": "pending", "pending": kind, "data": payload},
                    ],
                    final=False,
                )
                return (thread_id, ev.get("call_id"))
            if et == "done":
                await _persist_assistant(
                    session, thread_id,
                    parts=[
                        {"type": "text", "text": ev.get("answer", "")},
                        {"type": "citation_group", "citations": ev.get("citations", [])},
                        {"type": "activity_group", "activities": ev.get("activities", [])},
                        {
                            "type": "thinking_block",
                            "thinking": ev.get("thinking", ""),
                            "thinking_seconds": ev.get("thinking_seconds"),
                        },
                    ],
                    final=True,
                )
        return None

    try:
        while True:
            try:
                msg = await ws.receive_json()
            except json.JSONDecodeError:
                await _safe_send(ws, {"type": "error", "text": "could not parse message"})
                continue

            msg_type = msg.get("type")

            if msg_type == "user_message":
                text = (msg.get("text") or "").strip()
                if not text:
                    continue
                try:
                    thread_id = msg.get("thread_id")
                    if thread_id and not await thread_owned(
                        app.state.supabase, user_id=user_id, thread_id=thread_id
                    ):
                        thread_id = None
                    if not thread_id:
                        thread_id = await create_thread(
                            app.state.supabase, user_id=user_id, title=text[:60]
                        )
                        await _safe_send(ws, {"type": "thread", "id": thread_id})

                    stored = await get_thread_messages(
                        app.state.supabase, user_id=user_id, thread_id=thread_id
                    )
                    history = [
                        {
                            "role": m["role"],
                            "content": "".join(
                                part.get("text", "")
                                for part in (m.get("parts") or [])
                                if isinstance(part, dict) and part.get("type") == "text"
                            ),
                        }
                        for m in stored
                    ]

                    await append_message(
                        app.state.supabase, user_id=user_id, thread_id=thread_id,
                        role="user", parts=[{"type": "text", "text": text}],
                    )

                    tools = build_read_tools(
                        app.state.supabase, app.state.llm, user_id=user_id
                    ) + build_write_tools(app.state.supabase, user_id=user_id)
                    try:
                        tools += build_composio_tools(
                            user_id=user_id,
                            composio_service=getattr(app.state, "composio_service", None),
                            client=app.state.supabase,
                        )
                    except Exception as exc:  # noqa: BLE001 - chat still works without Composio
                        log.warning("composio_tools_unavailable", error=str(exc))
                    session = ChatSession(
                        app.state.supabase, app.state.llm,
                        user_id=user_id, thread_id=thread_id, tools=tools,
                        tz=msg.get("tz"),
                    )
                    sessions[thread_id] = session

                    suspended = await _drain(session, session.stream_turn(text, history), thread_id)
                except Exception as exc:  # noqa: BLE001 - keep the socket alive across a bad turn
                    log.warning("chat_turn_error", error=str(exc))
                    await _safe_send(
                        ws, {"type": "error", "text": "something went wrong on this turn"}
                    )

            elif msg_type in ("permission_decision", "connect_done"):
                # Prefer the client-supplied thread_id (so a decision made AFTER a
                # refresh, on a fresh socket with no local `suspended`, still finds
                # its paused session); fall back to this connection's suspended one.
                thread_id = msg.get("thread_id") or (suspended[0] if suspended else None)
                session = sessions.get(thread_id) if thread_id else None
                if session is None:
                    # Paused session is gone (e.g. the server restarted since the
                    # turn paused) — we can't resume the in-memory graph.
                    await _safe_send(
                        ws, {"type": "error", "text": "This request expired — please ask again."}
                    )
                    suspended = None
                    continue
                # permission → {decision, args} so edits made in the approval card
                # take effect; connect_done → "retry" to re-attempt the paused action.
                if msg_type == "permission_decision":
                    resume_value = {"decision": msg.get("decision"), "args": msg.get("args")}
                else:
                    resume_value = "retry"
                try:
                    suspended = await _drain(session, session.resume(resume_value), thread_id)
                except Exception as exc:  # noqa: BLE001 - keep the socket alive across a bad turn
                    log.warning("chat_turn_error", error=str(exc))
                    await _safe_send(
                        ws, {"type": "error", "text": "something went wrong on this turn"}
                    )

            else:
                continue
    except WebSocketDisconnect:
        return
