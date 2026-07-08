# tests/agent/kb/test_retrieval.py
import json

from stewardai.agent.kb.retrieval import retrieve


class _Resp:
    def __init__(self, data):
        self.data = data


class _RPC:
    def __init__(self, log, name, params):
        self._log, self._name, self._params = log, name, params

    async def execute(self):
        self._log.append({"rpc": self._name, "params": self._params})
        return _Resp([
            {"text": "we ship Friday", "meeting_id": "m1", "source_seq": 3,
             "kind": "segment", "similarity": 0.91},
        ])


class _Client:
    def __init__(self):
        self.calls = []

    def rpc(self, name, params):
        return _RPC(self.calls, name, params)


class _LLM:
    async def aembed(self, texts, *, query=False):
        assert query is True  # retrieval must use the QUERY task type
        return [[0.25] * 768 for _ in texts]


async def test_retrieve_embeds_query_and_calls_rpc_scoped_to_user():
    c, llm = _Client(), _LLM()
    rows = await retrieve(c, llm, user_id="u1", query="when do we ship?",
                          space_id="s1", k=5)
    assert rows and rows[0]["meeting_id"] == "m1"
    call = c.calls[0]
    assert call["rpc"] == "match_kb_chunks"
    assert call["params"]["p_user_id"] == "u1"
    assert call["params"]["p_space_id"] == "s1"
    assert call["params"]["match_count"] == 5
    # embedding passed as a JSON-array string (cast to ::vector in SQL)
    assert isinstance(call["params"]["query_embedding"], str)
    assert len(json.loads(call["params"]["query_embedding"])) == 768


async def test_retrieve_empty_query_returns_empty_without_calling_rpc():
    c, llm = _Client(), _LLM()
    assert await retrieve(c, llm, user_id="u1", query="   ") == []
    assert c.calls == []
