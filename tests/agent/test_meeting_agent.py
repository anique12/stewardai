from stewardai.agent.assembly import build_meeting_system, label_text
from stewardai.bridge.speaker_events import SpeakerTracker


def test_label_text_prefixes_active_speaker():
    t = SpeakerTracker()
    t.on_event("Anique", "start", 1)
    assert label_text(t, "ship it friday") == "[Anique]: ship it friday"


def test_label_text_falls_back_when_unknown():
    t = SpeakerTracker()
    assert label_text(t, "hello") == "[Speaker]: hello"


def test_meeting_system_uses_display_name_not_hardcoded():
    """The agent's identity + wake word come from the configured display name, and
    "Steward" is NOT hardcoded when a name is given."""
    p = build_meeting_system("Anique's AI Assistant", tools_available=False)
    assert "You are Anique's AI Assistant" in p
    assert 'addresses you by name ("Anique\'s AI Assistant")' in p
    assert "Steward" not in p


def test_meeting_system_no_tools_note_forbids_claiming_actions():
    """With no tools loaded, the prompt tells the agent NOT to claim it's acting."""
    p = build_meeting_system("Jarvis", tools_available=False)
    assert "do NOT say you are doing it" in p
    assert "Google Calendar" not in p  # the "you have tools" note is absent


def test_meeting_system_tools_note_interpolates_name():
    """With tools loaded, the tool-use guidance is present and uses the display name."""
    p = build_meeting_system("Jarvis", tools_available=True)
    assert "Jarvis, send" in p and "Google Calendar" in p
    assert "Steward" not in p


def test_meeting_system_default_name_is_steward():
    """Default fallback (no configured name) is still "Steward"."""
    assert "You are Steward" in build_meeting_system()
