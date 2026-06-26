from stewardai.config import Settings


def test_defaults():
    s = Settings(_env_file=None)
    assert s.device == "cpu"
    assert s.stt_backend == "stub"
    assert s.tts_backend == "stub"
    assert s.llm_backend == "litellm"


def test_resolved_llm_model_adds_gemini_prefix():
    s = Settings(_env_file=None, gemini_model="gemini-2.0-flash")
    assert s.resolved_llm_model == "gemini/gemini-2.0-flash"


def test_explicit_llm_model_wins():
    s = Settings(_env_file=None, llm_model="gemini/custom-model")
    assert s.resolved_llm_model == "gemini/custom-model"
