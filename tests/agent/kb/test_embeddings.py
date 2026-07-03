# tests/agent/kb/test_embeddings.py
import json

import litellm

from stewardai.agent.kb.embeddings import index_meeting_chunks
from stewardai.llm.litellm_client import LiteLLMClient


async def test_aembed_returns_one_vector_per_input_and_sets_task_type(monkeypatch):
    seen = {}

    async def fake_aembedding(*, model, input, **kwargs):
        seen["model"] = model
        seen["input"] = input
        seen["kwargs"] = kwargs

        class _R:
            data = [{"embedding": [0.1] * 768} for _ in input]

        return _R()

    monkeypatch.setattr(litellm, "aembedding", fake_aembedding)
    client = LiteLLMClient()

    docs = await client.aembed(["a", "b"], query=False)
    assert len(docs) == 2 and len(docs[0]) == 768
    assert "text-embedding-004" in seen["model"]
    assert seen["kwargs"].get("task_type") == "RETRIEVAL_DOCUMENT"

    await client.aembed(["q"], query=True)
    assert seen["kwargs"].get("task_type") == "RETRIEVAL_QUERY"


async def test_aembed_empty_input_returns_empty(monkeypatch):
    async def fake_aembedding(*, model, input, **kwargs):  # pragma: no cover - must not be called
        raise AssertionError("aembedding should not be called for empty input")

    monkeypatch.setattr(litellm, "aembedding", fake_aembedding)
    client = LiteLLMClient()
    assert await client.aembed([]) == []


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, log, table):
        self._log, self._t, self._op, self._payload = log, table, None, None

    def select(self, *_a):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, *_a):
        return self

    async def execute(self):
        self._log.append({"table": self._t, "op": self._op, "payload": self._payload})
        if self._t == "summaries" and self._op == "select":
            return _Resp([{"tldr": "Shipped the thing."}])
        return _Resp([])


class _Client:
    def __init__(self):
        self.calls = []

    def table(self, name):
        return _Query(self.calls, name)


class _LLM:
    def __init__(self):
        self.embedded = None

    async def aembed(self, texts, *, query=False):
        self.embedded = list(texts)
        return [[0.0] * 768 for _ in texts]


def _ops(client, table, op):
    return [c["payload"] for c in client.calls if c["table"] == table and c["op"] == op]


async def test_index_meeting_chunks_deletes_then_inserts_with_embeddings():
    c, llm = _Client(), _LLM()
    n = await index_meeting_chunks(
        c, llm, user_id="u1", space_id="s1", meeting_id="m1",
        transcript=["Alice: hi", "Bob: we ship Friday"],
        facts=[{"kind": "decision", "text": "Ship Friday", "source_line": 1}],
    )
    assert n >= 3  # >=1 transcript window + summary + 1 fact
    # idempotent: existing rows for the meeting are deleted before insert
    assert _ops(c, "kb_chunks", "delete") != []
    rows = _ops(c, "kb_chunks", "insert")[0]
    assert all(r["user_id"] == "u1" and r["meeting_id"] == "m1" for r in rows)
    assert all(len(json.loads(r["embedding"])) == 768 for r in rows)
    assert any(r["kind"] == "summary" and r["text"] == "Shipped the thing." for r in rows)
    assert any(r["kind"] == "fact" and r["source_seq"] == 1 for r in rows)


async def test_index_meeting_chunks_noop_when_nothing_to_embed():
    llm = _LLM()
    # empty transcript + no facts; summary lookup returns rows but we force empty below
    # Patch summaries lookup to return no tldr by using a client with no summary row:
    class _EmptyQuery(_Query):
        async def execute(self):
            self._log.append({"table": self._t, "op": self._op, "payload": self._payload})
            return _Resp([])

    class _EmptyClient(_Client):
        def table(self, name):
            return _EmptyQuery(self.calls, name)

    ec = _EmptyClient()
    n = await index_meeting_chunks(ec, llm, user_id="u1", space_id=None,
                                   meeting_id="m1", transcript=[], facts=[])
    assert n == 0
    assert _ops(ec, "kb_chunks", "insert") == []  # nothing inserted
