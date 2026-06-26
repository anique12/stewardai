import sys
import types

from stewardai.common.audio import Message
from stewardai.config import Settings


async def test_litellm_wiring(monkeypatch):
    captured: dict = {}

    class _Delta:
        def __init__(self, c):
            self.content = c

    class _Choice:
        def __init__(self, c):
            self.delta = _Delta(c)

    class _Chunk:
        def __init__(self, c):
            self.choices = [_Choice(c)]

    async def fake_acompletion(*, model, messages, stream, temperature):
        captured["model"] = model
        captured["messages"] = messages

        async def gen():
            for word in ["Hello", " world"]:
                yield _Chunk(word)

        return gen()

    monkeypatch.setitem(sys.modules, "litellm", types.SimpleNamespace(acompletion=fake_acompletion))

    from stewardai.llm.litellm_client import LiteLLMClient

    client = LiteLLMClient(
        Settings(_env_file=None, gemini_model="gemini-2.0-flash", gemini_api_key="x")
    )
    out = "".join([d async for d in client.complete([Message("user", "hi")], system="sys")])

    assert out == "Hello world"
    assert captured["model"] == "gemini/gemini-2.0-flash"
    assert captured["messages"][0]["role"] == "system"
    assert captured["messages"][1]["content"] == "hi"
