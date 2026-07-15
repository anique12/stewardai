# tests/email/test_bot_failed_enqueue.py
from __future__ import annotations

from stewardai.email.outbox import enqueue_bot_failed


class _Settings:
    email_enabled = True


class _Table:
    def __init__(self, store):
        self._store, self._payload = store, None

    def insert(self, row):
        self._payload = row
        return self

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def limit(self, *_):
        return self

    def maybe_single(self):
        return self

    async def execute(self):
        if self._payload is not None:
            self._store.append(self._payload)
            return type("R", (), {"data": [{}]})()
        return type("R", (), {"data": {"email": "owner@x.ai"}})()


class _Client:
    def __init__(self, store):
        self._store = store

    def table(self, _):
        return _Table(self._store)


async def test_enqueue_bot_failed_resolves_owner_and_inserts():
    store = []
    await enqueue_bot_failed(
        _Client(store), _Settings(), user_id="u1", meeting_id="m1",
        title="Daily Standup", reason="not admitted",
    )
    assert store and store[0]["kind"] == "bot_failed"
    assert store[0]["to_email"] == "owner@x.ai"
    assert store[0]["dedup_key"] == "bot_failed:m1"
    assert store[0]["payload"]["title"] == "Daily Standup"
