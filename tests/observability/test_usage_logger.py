"""Tests for build_usage_row (pure mapper) + cost fallback."""
from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from stewardai.observability import usage_logger as ul
from stewardai.observability.usage_logger import _PRICE_OVERRIDES, build_usage_row

START = datetime(2026, 7, 4, 10, 0, 0)
END = datetime(2026, 7, 4, 10, 0, 1)  # +1s


def _usage(p, c, t=None):
    return SimpleNamespace(prompt_tokens=p, completion_tokens=c, total_tokens=t if t is not None else p + c)


def _resp(content=None, tool_calls=None, usage=None):
    msg = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=usage)


def test_success_row_tokens_cost_attribution():
    kwargs = {
        "model": "gemini-2.5-pro",
        "response_cost": 0.002,
        "messages": [{"role": "user", "content": "hi"}],
        "custom_llm_provider": "gemini",
    }
    r = build_usage_row(
        kwargs, _resp(content="hello", usage=_usage(10, 5)), START, END,
        ctx={"user_id": "u", "feature": "chat", "request_id": "rq", "thread_id": "t"},
    )
    assert (r["input_tokens"], r["output_tokens"], r["total_tokens"]) == (10, 5, 15)
    assert r["cost_usd"] == 0.002
    assert r["status"] == "success"
    assert (r["user_id"], r["feature"], r["request_id"], r["thread_id"]) == ("u", "chat", "rq", "t")
    assert r["response"] == "hello"
    assert r["model"] == "gemini-2.5-pro" and r["provider"] == "gemini"
    assert r["model_role"] == "reasoning"
    assert r["latency_ms"] == 1000
    assert r["prompt"] == [{"role": "user", "content": "hi"}]


def test_tool_calls_extracted_and_unknown_attribution():
    tcs = [SimpleNamespace(function=SimpleNamespace(name="kb_search", arguments='{"q":"acme"}'))]
    r = build_usage_row({"model": "gemini-2.5-pro"}, _resp(tool_calls=tcs, usage=_usage(3, 0)), START, END, ctx={})
    assert r["tool_calls"] == [{"name": "kb_search", "args": {"q": "acme"}}]
    assert r["feature"] == "unknown" and r["user_id"] is None


def test_failure_row_zero_tokens():
    r = build_usage_row(
        {"model": "gemini-2.5-pro"}, None, START, END,
        ctx={"feature": "chat"}, status="error", error="boom",
    )
    assert r["status"] == "error" and r["error"] == "boom"
    assert (r["input_tokens"], r["output_tokens"]) == (0, 0)


def test_cost_override_when_litellm_cannot_price(monkeypatch):
    monkeypatch.setattr(ul, "_litellm_cost", lambda resp: 0.0)  # force fallback
    assert "gemini-embedding-001" in _PRICE_OVERRIDES
    r = build_usage_row(
        {"model": "gemini-embedding-001"}, _resp(usage=_usage(1000, 0)), START, END, ctx={},
    )
    in_rate, _ = _PRICE_OVERRIDES["gemini-embedding-001"]
    assert r["model_role"] == "embedding"
    assert abs(r["cost_usd"] - 1000 * in_rate) < 1e-12
    assert r["cost_usd"] > 0


def test_cost_zero_when_unpriced_and_no_override(monkeypatch):
    monkeypatch.setattr(ul, "_litellm_cost", lambda resp: 0.0)
    r = build_usage_row({"model": "some-unknown-model"}, _resp(usage=_usage(5, 5)), START, END, ctx={})
    assert r["cost_usd"] == 0.0


# --- UsageLogger callback + best-effort insert ---------------------------------


class _FakeClient:
    def __init__(self, fail=False):
        self.rows: list[dict] = []
        self.fail = fail
        self._row = None

    def table(self, name):
        self.table_name = name
        return self

    def insert(self, row):
        self._row = row
        return self

    async def execute(self):
        if self.fail:
            raise RuntimeError("db down")
        self.rows.append(self._row)
        return SimpleNamespace(data=[self._row])


async def test_success_event_writes_one_row(monkeypatch):
    fake = _FakeClient()
    monkeypatch.setattr(ul, "_client", fake)
    monkeypatch.setattr(ul, "_client_factory", None)
    lg = ul.UsageLogger()
    await lg.async_log_success_event(
        {"model": "gemini-2.5-pro", "response_cost": 0.001, "messages": []},
        _resp(content="x", usage=_usage(1, 1)), START, END,
    )
    assert len(fake.rows) == 1
    assert fake.rows[0]["model"] == "gemini-2.5-pro"
    assert fake.rows[0]["cost_usd"] == 0.001
    assert fake.table_name == "usage_logs"


async def test_insert_failure_is_swallowed(monkeypatch):
    fake = _FakeClient(fail=True)
    monkeypatch.setattr(ul, "_client", fake)
    monkeypatch.setattr(ul, "_client_factory", None)
    lg = ul.UsageLogger()
    # Must NOT raise even though the DB write fails.
    await lg.async_log_success_event({"model": "m"}, _resp(usage=_usage(1, 1)), START, END)


async def test_failure_event_records_error(monkeypatch):
    fake = _FakeClient()
    monkeypatch.setattr(ul, "_client", fake)
    monkeypatch.setattr(ul, "_client_factory", None)
    lg = ul.UsageLogger()
    await lg.async_log_failure_event(
        {"model": "m", "exception": "rate limited"}, None, START, END,
    )
    assert len(fake.rows) == 1
    assert fake.rows[0]["status"] == "error"
    assert fake.rows[0]["error"] == "rate limited"
