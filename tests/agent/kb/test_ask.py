# tests/agent/kb/test_ask.py
import stewardai.agent.kb.ask as ask_mod
from stewardai.agent.kb.ask import answer_question


class _LLM:
    def __init__(self):
        self.system = None
        self.messages = None

    async def complete(self, messages, *, system=None, temperature=0.4):
        self.system = system
        self.messages = messages
        for token in ["We ship ", "Friday [1]."]:
            yield token


async def test_answer_question_builds_context_and_returns_citations(monkeypatch):
    async def fake_retrieve(client, llm, *, user_id, query, space_id=None, k=8):
        return [
            {"text": "we ship Friday", "meeting_id": "m1", "source_seq": 3,
             "kind": "segment", "similarity": 0.9},
            {"text": "Ship Friday", "meeting_id": "m1", "source_seq": 1,
             "kind": "fact", "similarity": 0.8},
        ]

    monkeypatch.setattr(ask_mod, "retrieve", fake_retrieve)
    llm = _LLM()
    out = await answer_question(llm and object(), llm, user_id="u1",
                                query="when do we ship?")
    assert out["answer"] == "We ship Friday [1]."
    assert [c["n"] for c in out["citations"]] == [1, 2]
    assert out["citations"][0]["meeting_id"] == "m1"
    assert out["citations"][0]["source_seq"] == 3
    # the numbered context reached the model
    assert "[1]" in llm.messages[-1].content and "we ship Friday" in llm.messages[-1].content


async def test_answer_question_no_hits_returns_dont_know_without_calling_llm(monkeypatch):
    async def fake_retrieve(*a, **k):
        return []

    called = {"llm": False}

    class _NoLLM:
        async def complete(self, *a, **k):  # pragma: no cover - must not run
            called["llm"] = True
            yield ""

    monkeypatch.setattr(ask_mod, "retrieve", fake_retrieve)
    out = await answer_question(object(), _NoLLM(), user_id="u1", query="anything?")
    assert out["citations"] == []
    assert "don't have" in out["answer"].lower() or "no" in out["answer"].lower()
    assert called["llm"] is False
