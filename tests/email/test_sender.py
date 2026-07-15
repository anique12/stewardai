from __future__ import annotations

from datetime import UTC, datetime, timedelta

from stewardai.email.sender import run_pending_emails_once


class _Settings:
    email_from = "Steward <n@x.ai>"
    email_reply_to = None
    public_app_url = "https://app.x.ai"


class _FakeResend:
    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    async def send(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise RuntimeError("boom")
        return "msg_1"


class _Q:
    """Minimal fake: one pending row; records updates."""
    def __init__(self, row, suppressed=False):
        self._row, self._suppressed = row, suppressed
        self.updates = []
        self._mode = None

    def table(self, name):
        self._mode = name
        return self

    def select(self, *_):
        self._op = "select"
        return self

    def update(self, patch):
        self._op, self._patch = "update", patch
        return self

    def eq(self, *a):
        self._eq = a
        return self

    def lte(self, *_):
        return self

    def limit(self, *_):
        return self

    def order(self, *_ , **__):
        return self

    async def execute(self):
        if self._mode == "email_suppressions":
            return type("R", (), {"data": [{"email": "x"}] if self._suppressed else []})()
        if self._op == "select":
            return type("R", (), {"data": [self._row]})()
        self.updates.append(self._patch)
        return type("R", (), {"data": [{}]})()


async def test_sends_pending_and_marks_sent():
    row = {"id": "1", "kind": "welcome", "to_email": "o@x.ai", "dedup_key": "welcome:u1",
           "payload": {"name": "A"}, "attempts": 0}
    q, resend = _Q(row), _FakeResend()
    n = await run_pending_emails_once(q, resend, _Settings())
    assert n == 1
    assert resend.calls[0]["idempotency_key"] == "welcome:u1"
    assert any(u.get("status") == "sent" for u in q.updates)


async def test_suppressed_marks_suppressed_and_does_not_send():
    row = {"id": "1", "kind": "welcome", "to_email": "o@x.ai", "dedup_key": "welcome:u1",
           "payload": {}, "attempts": 0}
    q, resend = _Q(row, suppressed=True), _FakeResend()
    n = await run_pending_emails_once(q, resend, _Settings())
    assert n == 0
    assert resend.calls == []
    assert any(u.get("status") == "suppressed" for u in q.updates)


async def test_failure_increments_attempts():
    row = {"id": "1", "kind": "welcome", "to_email": "o@x.ai", "dedup_key": "welcome:u1",
           "payload": {}, "attempts": 0}
    q, resend = _Q(row), _FakeResend(fail=True)
    n = await run_pending_emails_once(q, resend, _Settings())
    assert n == 0
    assert any(u.get("attempts") == 1 for u in q.updates)


async def test_stale_welcome_is_canceled_not_sent():
    stale_created_at = (datetime.now(UTC) - timedelta(days=3)).isoformat()
    row = {"id": "1", "kind": "welcome", "to_email": "o@x.ai", "dedup_key": "welcome:u1",
           "payload": {}, "attempts": 0, "created_at": stale_created_at}
    q, resend = _Q(row), _FakeResend()
    n = await run_pending_emails_once(q, resend, _Settings())
    assert n == 0
    assert resend.calls == []
    assert any(u.get("status") == "canceled" for u in q.updates)


async def test_fresh_welcome_still_sends():
    fresh_created_at = datetime.now(UTC).isoformat()
    row = {"id": "1", "kind": "welcome", "to_email": "o@x.ai", "dedup_key": "welcome:u1",
           "payload": {}, "attempts": 0, "created_at": fresh_created_at}
    q, resend = _Q(row), _FakeResend()
    n = await run_pending_emails_once(q, resend, _Settings())
    assert n == 1
    assert any(u.get("status") == "sent" for u in q.updates)
