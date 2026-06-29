from stewardai.agent.assembly import label_text
from stewardai.bridge.speaker_events import SpeakerTracker


def test_label_text_prefixes_active_speaker():
    t = SpeakerTracker()
    t.on_event("Anique", "start", 1)
    assert label_text(t, "ship it friday") == "[Anique]: ship it friday"


def test_label_text_falls_back_when_unknown():
    t = SpeakerTracker()
    assert label_text(t, "hello") == "[Speaker]: hello"
