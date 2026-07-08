"""Tests for the DB-driven integration registry (available slugs + cache + fallback)."""
from __future__ import annotations

from types import SimpleNamespace

import stewardai.agent.chat.registry as reg


class _FakeQuery:
    def __init__(self, rows, fail=False):
        self._rows = rows
        self._fail = fail

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    async def execute(self):
        if self._fail:
            raise RuntimeError("relation \"integrations\" does not exist")
        return SimpleNamespace(data=self._rows)


class _FakeClient:
    def __init__(self, rows, fail=False):
        self._rows = rows
        self._fail = fail
        self.table_calls = 0

    def table(self, name):
        self.table_calls += 1
        return _FakeQuery(self._rows, self._fail)


async def test_load_available_returns_slugs():
    reg._reset_cache_for_tests()
    client = _FakeClient([{"slug": "gmail"}, {"slug": "googledrive"}])
    assert await reg.load_available(client) == ["gmail", "googledrive"]


async def test_falls_back_on_db_error():
    reg._reset_cache_for_tests()
    client = _FakeClient([], fail=True)
    assert await reg.load_available(client) == ["gmail", "googlecalendar"]


async def test_falls_back_when_client_none():
    reg._reset_cache_for_tests()
    assert await reg.load_available(None) == ["gmail", "googlecalendar"]


async def test_caches_within_ttl():
    reg._reset_cache_for_tests()
    client = _FakeClient([{"slug": "gmail"}])
    await reg.load_available(client)
    await reg.load_available(client)
    assert client.table_calls == 1  # second call served from cache
