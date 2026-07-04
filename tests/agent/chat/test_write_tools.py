"""Tests for product-ops write tools: ownership re-check, gate integration,
and the exact REST mutations performed on auto/approve vs skip."""
from __future__ import annotations

import stewardai.agent.chat.write_tools as WT
from stewardai.agent.chat.write_tools import build_write_tools


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, client, table):
        self._client = client
        self._t = table
        self._op = None
        self._payload = None
        self._filters: list[tuple[str, object]] = []
        self._on_conflict = None

    def select(self, *_a, **_k):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        self._op = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    async def execute(self):
        self._client.calls.append({
            "table": self._t, "op": self._op, "payload": self._payload,
            "filters": list(self._filters), "on_conflict": self._on_conflict,
        })
        if self._op == "select":
            rows = self._client.rows.get(self._t, [])
            matched = [r for r in rows if all(r.get(k) == v for k, v in self._filters)]
            return _Resp(matched)
        return _Resp([{"id": f"{self._t}-1"}])


class _Client:
    def __init__(self, rows=None):
        self.calls = []
        self.rows = rows or {}

    def table(self, name):
        return _Query(self, name)


def _ops(client, table, op):
    return [c["payload"] for c in client.calls if c["table"] == table and c["op"] == op]


async def _auto(*_a, **_k):
    return "auto", None


async def _reject(*_a, **_k):
    return "reject", None


def _rows():
    return {
        "spaces": [{"id": "s1", "user_id": "u1"}],
        "meetings": [{"id": "m1", "user_id": "u1"}],
        "action_items": [{"id": "a1", "meeting_id": "m1"}],
    }


async def test_create_space_inserts_with_user_id_and_returns_ok(monkeypatch):
    monkeypatch.setattr(WT, "gate", _auto)
    c = _Client()
    tools = build_write_tools(c, user_id="u1")
    create_space = next(t for t in tools if t.name == "create_space")
    out = await create_space.ainvoke({"name": "Acme", "kind": "client"})
    assert out["ok"] is True
    assert out["id"] == "spaces-1"
    assert _ops(c, "spaces", "insert")[0] == {"user_id": "u1", "name": "Acme", "kind": "client"}


async def test_file_meeting_updates_space_with_manual_source(monkeypatch):
    monkeypatch.setattr(WT, "gate", _auto)
    c = _Client(_rows())
    tools = build_write_tools(c, user_id="u1")
    file_meeting = next(t for t in tools if t.name == "file_meeting")
    out = await file_meeting.ainvoke({"meeting_id": "m1", "space_id": "s1"})
    assert out["ok"] is True
    update = _ops(c, "meetings", "update")[0]
    assert update["space_id"] == "s1"
    assert update["space_source"] == "manual"
    assert update["space_confidence"] == 1.0


async def test_add_tag_upserts_with_user_id(monkeypatch):
    monkeypatch.setattr(WT, "gate", _auto)
    c = _Client(_rows())
    tools = build_write_tools(c, user_id="u1")
    add_tag = next(t for t in tools if t.name == "add_tag")
    out = await add_tag.ainvoke({"meeting_id": "m1", "tag": "pricing"})
    assert out["ok"] is True
    upserts = _ops(c, "meeting_tags", "upsert")
    assert upserts[0] == {"user_id": "u1", "meeting_id": "m1", "tag": "pricing"}


async def test_complete_action_item_sets_done_after_ownership_check(monkeypatch):
    monkeypatch.setattr(WT, "gate", _auto)
    c = _Client(_rows())
    tools = build_write_tools(c, user_id="u1")
    complete = next(t for t in tools if t.name == "complete_action_item")
    out = await complete.ainvoke({"action_item_id": "a1"})
    assert out["ok"] is True
    assert _ops(c, "action_items", "update")[0] == {"done": True}
    # ownership check flows action_items -> meetings
    assert any(call["table"] == "action_items" and call["op"] == "select" for call in c.calls)
    assert any(call["table"] == "meetings" and call["op"] == "select" for call in c.calls)


async def test_ownership_failure_returns_error_without_mutation(monkeypatch):
    monkeypatch.setattr(WT, "gate", _auto)
    c = _Client(_rows())  # "s-foreign" is not in the seeded spaces
    tools = build_write_tools(c, user_id="u1")
    rename = next(t for t in tools if t.name == "rename_space")
    out = await rename.ainvoke({"space_id": "s-foreign", "name": "New name"})
    assert out == {"error": "not found"}
    assert _ops(c, "spaces", "update") == []


async def test_gate_reject_skips_mutation(monkeypatch):
    monkeypatch.setattr(WT, "gate", _reject)
    c = _Client(_rows())
    tools = build_write_tools(c, user_id="u1")
    archive = next(t for t in tools if t.name == "archive_space")
    out = await archive.ainvoke({"space_id": "s1"})
    assert out == {"skipped": True}
    assert _ops(c, "spaces", "update") == []
