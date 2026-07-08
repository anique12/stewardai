"""Usage/cost logger: one global litellm callback → a ``usage_logs`` row per call.

``build_usage_row`` is a pure mapper (litellm event → row dict) so it is unit
tested without litellm. ``UsageLogger`` is the litellm ``CustomLogger`` that
calls it on every completion/embedding and writes the row best-effort. All
attribution comes from :func:`stewardai.observability.usage_context.current_usage`.
"""
from __future__ import annotations

import json
from typing import Any

from stewardai.common.logging import get_logger
from stewardai.observability.usage_context import current_usage

log = get_logger("observability.usage")

try:  # litellm is a hard dep in the app; guard so the pure mapper stays importable
    from litellm.integrations.custom_logger import CustomLogger
except Exception:  # pragma: no cover - only when litellm is absent
    CustomLogger = object  # type: ignore[assignment,misc]

# Per-token USD rates for models litellm cannot price on its own. Keyed by the
# model name without any provider prefix. gemini-embedding-001: $0.15 / 1M input.
_PRICE_OVERRIDES: dict[str, tuple[float, float]] = {
    "gemini-embedding-001": (0.15 / 1_000_000, 0.0),
}


def _norm_model(model: str | None) -> str:
    return (model or "").split("/")[-1]


def _role_for(model: str | None) -> str | None:
    m = (model or "").lower()
    if "embedding" in m:
        return "embedding"
    if "lite" in m or "flash" in m:
        return "utility"
    if "pro" in m:
        return "reasoning"
    return None


def _attr(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _litellm_cost(response_obj: Any) -> float:
    try:
        import litellm

        return float(litellm.completion_cost(completion_response=response_obj) or 0.0)
    except Exception:  # noqa: BLE001 - unknown model / bad shape → no cost from litellm
        return 0.0


def _cost(kwargs: dict, response_obj: Any, input_tokens: int, output_tokens: int) -> float:
    c = kwargs.get("response_cost")
    if isinstance(c, (int, float)) and c > 0:
        return float(c)
    cc = _litellm_cost(response_obj)
    if cc > 0:
        return cc
    rates = _PRICE_OVERRIDES.get(_norm_model(kwargs.get("model")))
    if rates:
        return round((input_tokens or 0) * rates[0] + (output_tokens or 0) * rates[1], 10)
    log.warning("usage_cost_unpriced", model=kwargs.get("model"))
    return 0.0


def _tool_calls(response_obj: Any) -> list[dict] | None:
    try:
        choices = _attr(response_obj, "choices") or []
        if not choices:
            return None
        msg = _attr(choices[0], "message")
        tcs = _attr(msg, "tool_calls")
        if not tcs:
            return None
        out: list[dict] = []
        for tc in tcs:
            fn = _attr(tc, "function")
            name = _attr(fn, "name")
            raw = _attr(fn, "arguments")
            args: Any = raw
            if isinstance(raw, str):
                try:
                    args = json.loads(raw)
                except Exception:  # noqa: BLE001 - keep the raw string if not JSON
                    args = raw
            out.append({"name": name, "args": args})
        return out or None
    except Exception:  # noqa: BLE001 - never let extraction break logging
        return None


def _response_text(response_obj: Any) -> str | None:
    try:
        choices = _attr(response_obj, "choices") or []
        if not choices:
            return None
        content = _attr(_attr(choices[0], "message"), "content")
        if content is None:
            return None
        return content if isinstance(content, str) else str(content)
    except Exception:  # noqa: BLE001
        return None


def _latency_ms(start: Any, end: Any) -> int | None:
    try:
        return int((end - start).total_seconds() * 1000)
    except Exception:  # noqa: BLE001 - start/end not datetimes
        return None


def _provider(kwargs: dict) -> str | None:
    prov = kwargs.get("custom_llm_provider")
    if prov:
        return prov
    try:
        md = (kwargs.get("litellm_params") or {}).get("metadata") or {}
        return (md.get("hidden_params") or {}).get("custom_llm_provider")
    except Exception:  # noqa: BLE001
        return None


def build_usage_row(
    kwargs: dict,
    response_obj: Any,
    start: Any,
    end: Any,
    *,
    ctx: dict,
    status: str = "success",
    error: str | None = None,
) -> dict:
    """Map one litellm success/failure event to a ``usage_logs`` row dict.

    Pure: no I/O, no litellm objects required (works on dicts / SimpleNamespace).
    Attribution comes from ``ctx`` (see ``current_usage()``); missing → unknown.
    """
    usage = _attr(response_obj, "usage")
    input_tokens = int(_attr(usage, "prompt_tokens", 0) or 0)
    output_tokens = int(_attr(usage, "completion_tokens", 0) or 0)
    total_tokens = int(_attr(usage, "total_tokens", input_tokens + output_tokens) or 0)
    model = kwargs.get("model") or ""
    return {
        "user_id": ctx.get("user_id"),
        "feature": ctx.get("feature") or "unknown",
        "request_id": ctx.get("request_id"),
        "thread_id": ctx.get("thread_id"),
        "model": model,
        "model_role": _role_for(model),
        "provider": _provider(kwargs),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "cost_usd": _cost(kwargs, response_obj, input_tokens, output_tokens),
        "latency_ms": _latency_ms(start, end),
        "status": status,
        "error": error,
        "tool_calls": _tool_calls(response_obj),
        "prompt": kwargs.get("messages"),
        "response": _response_text(response_obj),
        "context": ctx.get("context"),
    }


# ---------------------------------------------------------------------------
# Callback + best-effort write
# ---------------------------------------------------------------------------

_client: Any = None
_client_factory: Any = None


def install_usage_logger(client_factory: Any) -> Any:
    """Register the global litellm callback (idempotent). ``client_factory`` is
    an async callable returning a service-role Supabase client, created lazily on
    the first logged call."""
    global _client_factory
    _client_factory = client_factory
    import litellm

    existing = list(litellm.callbacks or [])
    if not any(isinstance(c, UsageLogger) for c in existing):
        existing.append(UsageLogger())
        litellm.callbacks = existing
    return existing


async def _get_client() -> Any:
    global _client
    if _client is None and _client_factory is not None:
        import inspect

        res = _client_factory()
        _client = await res if inspect.isawaitable(res) else res
    return _client


async def _insert_row(row: dict) -> None:
    client = await _get_client()
    if client is None:
        return
    await client.table("usage_logs").insert(row).execute()


async def purge_usage_logs(older_than_days: int = 90) -> int | None:
    """Delete usage_logs rows older than ``older_than_days`` (full prompt/response
    is sensitive at rest). Returns the deleted count, or None if no client.
    Call from a scheduled job / cron; safe to run repeatedly."""
    from datetime import UTC, datetime, timedelta

    client = await _get_client()
    if client is None:
        return None
    cutoff = (datetime.now(UTC) - timedelta(days=older_than_days)).isoformat()
    res = await client.table("usage_logs").delete().lt("created_at", cutoff).execute()
    return len(getattr(res, "data", None) or [])


class UsageLogger(CustomLogger):  # type: ignore[misc,valid-type]
    """litellm callback: write one ``usage_logs`` row per completion/embedding.

    Best-effort — a logging fault (bad row, DB down, missing client) is
    swallowed so it can NEVER break the user's turn.
    """

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):  # noqa: ANN001
        await self._record(kwargs, response_obj, start_time, end_time, status="success")

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):  # noqa: ANN001
        err = str(kwargs.get("exception") or "") or "error"
        await self._record(kwargs, response_obj, start_time, end_time, status="error", error=err)

    async def _record(self, kwargs, response_obj, start, end, *, status, error=None):  # noqa: ANN001
        try:
            row = build_usage_row(
                kwargs or {}, response_obj, start, end,
                ctx=current_usage(), status=status, error=error,
            )
            await _insert_row(row)
        except Exception as exc:  # noqa: BLE001 - logging must never break a turn
            log.warning("usage_log_failed", error=str(exc))
