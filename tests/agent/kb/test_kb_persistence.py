# tests/agent/kb/test_kb_persistence.py
from stewardai.agent.kb import persistence as kbp


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, log, table):
        self._log, self._t, self._op, self._payload = log, table, None, None

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def upsert(self, payload, **_k):
        self._op, self._payload = "upsert", payload
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, *_a):
        return self

    async def execute(self):
        self._log.append({"table": self._t, "op": self._op, "payload": self._payload})
        rid = f"{self._t}-1"
        return _Resp([{"id": rid}])


class _Client:
    def __init__(self):
        self.calls = []

    def table(self, name):
        return _Query(self.calls, name)


def _ops(client, table, op):
    return [c["payload"] for c in client.calls if c["table"] == table and c["op"] == op]


async def test_create_space_returns_id_and_writes_user_id():
    c = _Client()
    sid = await kbp.create_space(c, user_id="u1", name="Acme")
    assert sid == "spaces-1"
    assert _ops(c, "spaces", "insert")[0] == {"user_id": "u1", "name": "Acme"}


async def test_insert_facts_writes_provenance_and_skips_when_no_space():
    c = _Client()
    n = await kbp.insert_facts(c, user_id="u1", space_id="s1", meeting_id="m1", facts=[
        {"kind": "decision", "text": "Dropped tier-3", "source_line": 4, "due": None},
        {"kind": "date", "text": "Contract ends", "source_line": 6, "due": "2026-07-31"},
    ])
    assert n == 2
    rows = _ops(c, "space_facts", "insert")[0]
    assert rows[0] == {"user_id": "u1", "space_id": "s1", "meeting_id": "m1",
                       "kind": "decision", "text": "Dropped tier-3", "source_seq": 4, "due": None}
    # no space -> nothing written
    c2 = _Client()
    assert await kbp.insert_facts(c2, user_id="u1", space_id=None, meeting_id="m1",
                                  facts=[{"kind": "risk", "text": "x", "source_line": None, "due": None}]) == 0
    assert c2.calls == []


async def test_set_meeting_tags_is_delete_then_insert():
    c = _Client()
    await kbp.set_meeting_tags(c, user_id="u1", meeting_id="m1", tags=["pricing", "renewal"])
    order = [x["op"] for x in c.calls if x["table"] == "meeting_tags"]
    assert order.index("delete") < order.index("insert")
    assert _ops(c, "meeting_tags", "insert")[0] == [
        {"user_id": "u1", "meeting_id": "m1", "tag": "pricing"},
        {"user_id": "u1", "meeting_id": "m1", "tag": "renewal"},
    ]


async def test_set_meeting_space_updates_meeting_row():
    c = _Client()
    await kbp.set_meeting_space(c, user_id="u1", meeting_id="m1",
                               space_id="s1", confidence=0.9, source="auto")
    assert _ops(c, "meetings", "update")[0] == {
        "space_id": "s1", "space_confidence": 0.9, "space_source": "auto"}
