"""LLM connection warmup.

The FIRST LiteLLM/Gemini call in a fresh process pays a large one-time cost
(TLS handshake + HTTP client init + provider metadata): measured ~5.8s cold vs
~0.56s warm. Draining one trivial completion at startup moves that cost off the
user's first turn. Best-effort: a failed warmup never blocks startup.
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
