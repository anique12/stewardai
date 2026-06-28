import pytest
from stewardai.common.audio import Decision, Message
from stewardai.llm.stub import StubLLM


async def test_stub_decide_speaks_when_scripted():
    llm = StubLLM()
    llm.next_decision = Decision(speak=True, text="Hello team.")
    d = await llm.decide([Message(role="user", content="hey stewardai, say hi")])
    assert d.speak is True
    assert d.text == "Hello team."


async def test_stub_decide_defaults_silent():
    llm = StubLLM()
    d = await llm.decide([Message(role="user", content="random chatter")])
    assert d.speak is False
    assert d.text == ""
