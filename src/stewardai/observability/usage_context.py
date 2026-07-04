"""Per-request attribution for usage logging.

The LLM call happens deep inside LangGraph (or Ask/summary/voice code), far from
where we know *who* is making the request. A ``ContextVar`` set at each entry
point carries ``{user_id, feature, request_id, thread_id, context}`` down to the
litellm callback (verified to propagate through ``ChatLiteLLM`` streaming). When
unset, ``current_usage()`` returns ``{}`` and the logger records the row with
``feature="unknown"`` / ``user_id=None`` — a log is never dropped.
"""
from __future__ import annotations

import contextvars
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

_usage_ctx: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "stewardai_usage_ctx", default=None
)


def current_usage() -> dict:
    """The active attribution dict, or ``{}`` outside any scope."""
    return _usage_ctx.get() or {}


@contextmanager
def usage_scope(
    *,
    feature: str,
    user_id: str | None = None,
    request_id: str | None = None,
    thread_id: str | None = None,
    context: Any = None,
) -> Iterator[None]:
    """Attribute every model call made inside the block to this user/feature/request.

    Nesting restores the prior scope on exit.
    """
    data = {
        "user_id": user_id,
        "feature": feature,
        "request_id": request_id,
        "thread_id": thread_id,
        "context": context,
    }
    token = _usage_ctx.set(data)
    try:
        yield
    finally:
        _usage_ctx.reset(token)
