from stewardai.common.audio import Message
from stewardai.llm.stub import StubLLM


async def test_stub_llm_echoes_user():
    deltas = [d async for d in StubLLM().complete([Message("user", "hi there")])]
    out = "".join(deltas)
    assert "hi there" in out
