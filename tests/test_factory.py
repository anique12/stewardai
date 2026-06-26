import pytest

from stewardai.common.errors import BackendUnavailable
from stewardai.config import Settings
from stewardai.factory import make_llm, make_stt, make_tts
from stewardai.interfaces import LLMBackend, STTBackend, TTSBackend


def test_make_stub_stt():
    stt = make_stt(Settings(_env_file=None, stt_backend="stub"))
    assert isinstance(stt, STTBackend)
    assert stt.name == "stub"


def test_make_stub_tts():
    tts = make_tts(Settings(_env_file=None, tts_backend="stub"))
    assert isinstance(tts, TTSBackend)
    assert tts.name == "stub"


def test_make_stub_llm():
    llm = make_llm(Settings(_env_file=None, llm_backend="stub"))
    assert isinstance(llm, LLMBackend)
    assert llm.name == "stub"


def test_unknown_backend_raises():
    with pytest.raises(BackendUnavailable):
        make_stt(Settings(_env_file=None, stt_backend="does-not-exist"))
