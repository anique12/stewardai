import pytest
from stewardai.common.audio import Decision, Message
from stewardai.llm.litellm_client import _parse_decision
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


# ---------------------------------------------------------------------------
# Pure parser tests — no network, no LLM call
# ---------------------------------------------------------------------------
class _FakeFn:
    def __init__(self, name, arguments):
        self.name = name
        self.arguments = arguments


class _FakeToolCall:
    def __init__(self, name, arguments):
        self.function = _FakeFn(name, arguments)


def test_parse_decision_speak():
    d = _parse_decision([_FakeToolCall("speak", '{"text": "On it."}')])
    assert d.speak is True and d.text == "On it."


def test_parse_decision_stay_silent():
    d = _parse_decision([_FakeToolCall("stay_silent", "{}")])
    assert d.speak is False and d.text == ""


def test_parse_decision_none_defaults_silent():
    assert _parse_decision(None).speak is False


def test_parse_decision_malformed_json():
    d = _parse_decision([_FakeToolCall("speak", "not-valid-json{")])
    assert d.speak is False
    assert d.text == ""
