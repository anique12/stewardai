from stewardai.agent.chat.models import pick_model


def test_pick_model_uses_config_defaults():
    assert "gemini" in pick_model("reasoning")
    assert "flash-lite" in pick_model("utility")


def test_pick_model_unknown_role_falls_back_to_reasoning():
    assert pick_model("something") == pick_model("reasoning")


def test_coerce_string_content_elements_wraps_bare_strings():
    from stewardai.agent.chat.models import _coerce_string_content_elements

    messages = [
        {"role": "system", "content": "you are steward"},  # plain string: untouched
        {"role": "assistant", "content": ["thinking text", {"type": "text", "text": "hi"}]},
    ]
    _coerce_string_content_elements(messages)

    assert messages[0]["content"] == "you are steward"  # non-list left as-is
    assert messages[1]["content"] == [
        {"type": "text", "text": "thinking text"},  # bare string → text block
        {"type": "text", "text": "hi"},  # dict block preserved
    ]


def test_install_gemini_content_shim_is_idempotent():
    import litellm

    from stewardai.agent.chat.models import _install_gemini_content_shim

    _install_gemini_content_shim()
    _install_gemini_content_shim()  # second call must be a no-op, not double-wrap
    assert getattr(litellm.GoogleAIStudioGeminiConfig, "_stewardai_content_shim", False) is True
