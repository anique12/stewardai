"""Structured logging + per-turn timing.

Every log line is JSON (or pretty console) and carries the current `turn_id` so a
whole conversational turn can be reconstructed. `TurnTimer` records per-stage
latencies (capture -> EOU -> STT -> LLM TTFT -> TTS TTFA -> playback) and emits a
single summary line per turn.
"""

from __future__ import annotations

import contextvars
import logging
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import structlog

_turn_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("turn_id", default=None)
_configured = False


def new_turn() -> str:
    """Start a new turn; subsequent logs carry this id until the next call."""
    tid = uuid.uuid4().hex[:12]
    _turn_id.set(tid)
    return tid


def current_turn() -> str | None:
    return _turn_id.get()


def _add_turn_id(_logger: object, _name: str, event_dict: dict) -> dict:
    tid = _turn_id.get()
    if tid is not None:
        event_dict.setdefault("turn_id", tid)
    return event_dict


def configure_logging(level: str = "info", fmt: str = "json") -> None:
    global _configured
    renderer = (
        structlog.processors.JSONRenderer()
        if fmt == "json"
        else structlog.dev.ConsoleRenderer()
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _add_turn_id,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


def get_logger(name: str = "stewardai") -> structlog.stdlib.BoundLogger:
    if not _configured:
        configure_logging()
    return structlog.get_logger(name)


class TurnTimer:
    """Accumulate per-stage latencies for one turn and emit a JSON summary.

    Usage:
        timer = TurnTimer()
        with timer.stage("stt"):
            ...
        timer.mark("llm_ttft")   # elapsed-since-turn-start checkpoint
        timer.summary()          # logs {"event": "turn_complete", t_stt, t_llm_ttft, ...}
    """

    def __init__(self, logger: structlog.stdlib.BoundLogger | None = None) -> None:
        self._start = time.perf_counter()
        self.t: dict[str, float] = {}
        self._log = logger or get_logger("turn")

    def _ms(self, seconds: float) -> float:
        return round(seconds * 1000, 1)

    def mark(self, name: str) -> None:
        """Record elapsed time since turn start as t_<name> (a checkpoint)."""
        self.t[name] = self._ms(time.perf_counter() - self._start)

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        """Time a block, recording its duration as t_<name>."""
        start = time.perf_counter()
        try:
            yield
        finally:
            self.t[name] = self._ms(time.perf_counter() - start)

    def summary(self) -> dict:
        data = {f"t_{k}": v for k, v in self.t.items()}
        data["t_total"] = self._ms(time.perf_counter() - self._start)
        self._log.info("turn_complete", **data)
        return data
