from stewardai.agent.chat.models import pick_model


def test_pick_model_uses_config_defaults():
    assert "gemini" in pick_model("reasoning")
    assert "flash-lite" in pick_model("utility")


def test_pick_model_unknown_role_falls_back_to_reasoning():
    assert pick_model("something") == pick_model("reasoning")
