from __future__ import annotations

from stewardai.email.outbox import enqueue, resolve_owner_email


class _Table:
    def __init__(self, store, raise_conflict=False):
        self._store, self._raise = store, raise_conflict
        self._payload = None

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
            if self._raise:
                raise Exception('duplicate key value violates unique constraint')
            self._store.append(self._payload)
        return type("R", (), {"data": {"email": "owner@x.ai"}})()


class _Client:
    def __init__(self, store, raise_conflict=False):
        self._store, self._raise = store, raise_conflict

    def table(self, _name):
        return _Table(self._store, self._raise)


async def test_enqueue_inserts_row():
    store = []
    ok = await enqueue(
        _Client(store), user_id="u1", kind="welcome", to_email="owner@x.ai",
        dedup_key="welcome:u1", enabled=True,
    )
    assert ok is True
    assert store[0]["dedup_key"] == "welcome:u1"
    assert store[0]["status"] == "pending"


async def test_enqueue_noop_when_disabled():
    store = []
    ok = await enqueue(
        _Client(store), user_id="u1", kind="welcome", to_email="o@x.ai",
        dedup_key="welcome:u1", enabled=False,
    )
    assert ok is False and store == []


async def test_enqueue_swallows_duplicate():
    ok = await enqueue(
        _Client([], raise_conflict=True), user_id="u1", kind="welcome",
        to_email="o@x.ai", dedup_key="welcome:u1", enabled=True,
    )
    assert ok is False


async def test_resolve_owner_email():
    assert await resolve_owner_email(_Client([]), "u1") == "owner@x.ai"
