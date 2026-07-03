# tests/agent/kb/test_embeddings.py
import litellm

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
