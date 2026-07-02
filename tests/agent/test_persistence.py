"""Tests for persist_meeting_artifacts (transcript/summary/action_items → Supabase)."""
from __future__ import annotations

from types import SimpleNamespace

from stewardai.agent.persistence import persist_meeting_artifacts

UUID = "11111111-1111-1111-1111-111111111111"


class _Query:
    """Records one query chain; execute() appends to the shared call log."""

    def __init__(self, table, op, calls, fail):
        self._t, self._op, self._calls, self._fail = table, op, calls, fail
        self.payload = None
        self.kwargs = {}
        self.filters = []

    def eq(self, k, v):
        self.filters.append((k, v))
        return self

    async def execute(self):
        self._calls.append(
            {"table": self._t, "op": self._op, "payload": self.payload,
             "kwargs": self.kwargs, "filters": self.filters}
        )
        if (self._t, self._op) in self._fail:
            raise RuntimeError("boom")
        return SimpleNamespace(data=[])


class _Table:
    def __init__(self, name, calls, fail):
        self._n, self._calls, self._fail = name, calls, fail

    def delete(self):
        return _Query(self._n, "delete", self._calls, self._fail)

    def insert(self, payload):
        q = _Query(self._n, "insert", self._calls, self._fail)
        q.payload = payload
        return q

    def upsert(self, payload, **kw):
        q = _Query(self._n, "upsert", self._calls, self._fail)
        q.payload = payload
        q.kwargs = kw
        return q


class _Client:
    def __init__(self, fail=None):
        self.calls = []
        self._fail = fail or set()

    def table(self, name):
        return _Table(name, self.calls, self._fail)


def _ops(client, table, op):
    return [c for c in client.calls if c["table"] == table and c["op"] == op]


async def test_transcript_parsed_and_replaced():
    client = _Client()
    transcript = ["[Alice]: hello there", "[Bob]: hi", "no bracket line", "[Carol]: "]
    await persist_meeting_artifacts(client, UUID, transcript, {"tldr": "x"})

    ins = _ops(client, "transcript_segments", "insert")
    assert len(ins) == 1
    rows = ins[0]["payload"]
    # "[Carol]: " has empty text → skipped; seq keeps the original enumerate index.
    assert rows == [
        {"meeting_id": UUID, "seq": 0, "speaker": "Alice", "text": "hello there"},
        {"meeting_id": UUID, "seq": 1, "speaker": "Bob", "text": "hi"},
        {"meeting_id": UUID, "seq": 2, "speaker": "Speaker", "text": "no bracket line"},
    ]
    # delete must run before insert (idempotent replace)
    order = [c["op"] for c in client.calls if c["table"] == "transcript_segments"]
    assert order.index("delete") < order.index("insert")
    assert _ops(client, "transcript_segments", "delete")[0]["filters"] == [("meeting_id", UUID)]


async def test_summary_upsert_shape():
    client = _Client()
    summary = {"tldr": "TL;DR here", "decisions": ["d1", "d2"], "discrepancies": ["x"]}
    await persist_meeting_artifacts(client, UUID, [], summary)

    ups = _ops(client, "summaries", "upsert")
    assert len(ups) == 1
    assert ups[0]["kwargs"] == {"on_conflict": "meeting_id"}
    row = ups[0]["payload"]
    assert row["meeting_id"] == UUID
    assert row["tldr"] == "TL;DR here"
    # Panel renders d.text → jsonb arrays of {"text": ...}, not bare strings.
    assert row["decisions"] == [{"text": "d1"}, {"text": "d2"}]
    assert row["discrepancies"] == [{"text": "x"}]


async def test_action_items_due_coercion_and_skips():
    client = _Client()
    summary = {
        "tldr": "t",
        "action_items": [
            {"owner": "Alice", "task": "ship it", "due": "2026-07-05"},   # real date kept
            {"owner": "", "task": "vague one", "due": "Friday afternoon"},  # vague → None, owner default
            {"owner": "Bob", "task": "   ", "due": None},                   # empty task → skipped
        ],
    }
    await persist_meeting_artifacts(client, UUID, [], summary)

    rows = _ops(client, "action_items", "insert")[0]["payload"]
    assert rows == [
        {
            "meeting_id": UUID,
            "owner": "Alice",
            "task": "ship it",
            "due": "2026-07-05",
            "source_seq": None,
        },
        {
            "meeting_id": UUID,
            "owner": "Unassigned",
            "task": "vague one",
            "due": None,
            "source_seq": None,
        },
    ]


async def test_no_insert_when_empty():
    client = _Client()
    await persist_meeting_artifacts(client, UUID, [], {"tldr": "t"})
    # No transcript rows and no action items → delete runs, insert does not.
    assert _ops(client, "transcript_segments", "insert") == []
    assert _ops(client, "action_items", "insert") == []
    # Summary still upserts (tldr present).
    assert len(_ops(client, "summaries", "upsert")) == 1


async def test_one_table_failure_does_not_block_others():
    # transcript_segments insert raises → summaries + action_items must still write.
    client = _Client(fail={("transcript_segments", "insert")})
    summary = {"tldr": "t", "action_items": [{"owner": "A", "task": "do", "due": None}]}
    await persist_meeting_artifacts(client, UUID, ["[A]: hi"], summary)
    assert len(_ops(client, "summaries", "upsert")) == 1
    assert len(_ops(client, "action_items", "insert")) == 1


async def test_action_items_writes_source_seq():
    client = _Client()
    summary = {
        "tldr": "t",
        "action_items": [
            {"owner": "Anique", "task": "send invite", "due": None, "source_line": 4}
        ],
    }
    await persist_meeting_artifacts(client, UUID, ["[Anique]: send invite"], summary)
    rows = _ops(client, "action_items", "insert")[0]["payload"]
    assert rows[0]["source_seq"] == 4
