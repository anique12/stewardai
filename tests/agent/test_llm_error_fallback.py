"""_addressed_by_name gates the spoken LLM-error fallback: it must fire only when the
bot was directly addressed (wake name in the latest user message), not on ambient turns
during an outage."""
from stewardai.agent.assembly import build_meeting_system
from stewardai.agent.nodes import _addressed_by_name


class _Msg:
    """Minimal stand-in for a livekit ChatMessage (role + content)."""

    def __init__(self, role: str, content: str) -> None:
        self.role = role
        self.content = content


def test_addressed_when_wake_name_in_last_user_message() -> None:
    system = build_meeting_system("Alex")
    msgs = [_Msg("user", "so about the roadmap"), _Msg("user", "Alex, what's the plan?")]
    assert _addressed_by_name(system, msgs) is True


def test_not_addressed_on_ambient_conversation() -> None:
    system = build_meeting_system("Alex")
    msgs = [_Msg("user", "we should ship on Friday I think")]
    assert _addressed_by_name(system, msgs) is False


def test_only_the_latest_user_message_counts() -> None:
    # Named earlier but the latest turn is ambient -> not addressed this turn.
    system = build_meeting_system("Alex")
    msgs = [_Msg("user", "Alex are you there"), _Msg("user", "anyway, moving on")]
    assert _addressed_by_name(system, msgs) is False


def test_no_system_prompt_is_not_addressed() -> None:
    assert _addressed_by_name(None, [_Msg("user", "Alex hi")]) is False


def test_uses_the_configured_name_not_hardcoded_steward() -> None:
    system = build_meeting_system("Jarvis")
    assert _addressed_by_name(system, [_Msg("user", "Jarvis, summarize that")]) is True
    assert _addressed_by_name(system, [_Msg("user", "Steward, summarize that")]) is False
