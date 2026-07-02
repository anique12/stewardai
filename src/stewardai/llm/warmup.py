"""Connection warmup (LLM + TTS).

The FIRST LiteLLM/Gemini call in a fresh process pays a large one-time cost
(TLS handshake + HTTP client init + provider metadata): measured ~5.8s cold vs
~0.56s warm. The FIRST streaming-TTS synth (Deepgram Aura) pays a similar cost
opening its websocket: measured ~12s cold vs ~0.4s warm. Draining one trivial
call at startup / session start moves that cost off the user's first turn.
Best-effort: a failed warmup never blocks startup.
"""

from __future__ import annotations

import contextlib
import time

from stewardai.common.audio import Message
from stewardai.common.logging import get_logger

_log = get_logger("llm.warmup")


async def warmup_llm(llm, *, quiet: bool = False) -> None:  # noqa: ANN001 - any LLMBackend
    """Establish the LLM's HTTP connection by draining one tiny completion.

    ``quiet=True`` suppresses the log line — used by the periodic keepalive so it
    doesn't spam a line every interval.
    """
    t0 = time.perf_counter()
    ok = False
    with contextlib.suppress(Exception):
        async for _delta in llm.complete([Message(role="user", content="hi")]):
            ok = True
            break  # first token proves the connection is warm
    if not quiet:
        _log.info("llm_warmup_done", ms=round((time.perf_counter() - t0) * 1000), ok=ok)


async def warmup_tts(tts, *, quiet: bool = False) -> None:  # noqa: ANN001 - livekit TTS plugin
    """Establish the TTS backend's connection by draining one throwaway synth.

    Streaming TTS (Deepgram Aura) opens its websocket lazily on the FIRST
    synthesize — a cold connection costs ~12s, which otherwise lands on the
    user's first reply. Draining one frame here moves that cost off the first
    turn. The throwaway audio is discarded (never routed to the meeting output).

    ``quiet=True`` suppresses the log line. Best-effort: a failed or unsupported
    warmup (e.g. a stub TTS) never breaks the session.
    """
    if tts is None:
        return
    t0 = time.perf_counter()
    ok = False
    try:
        stream = tts.synthesize("hi")
        try:
            async for _ev in stream:
                ok = True
                break  # first frame proves the connection is warm
        finally:
            with contextlib.suppress(Exception):
                await stream.aclose()
    except Exception as exc:  # noqa: BLE001 - warmup must never break the session
        if not quiet:
            _log.warning("tts_warmup_failed", error=str(exc))
        return
    if not quiet:
        _log.info("tts_warmup_done", ms=round((time.perf_counter() - t0) * 1000), ok=ok)
