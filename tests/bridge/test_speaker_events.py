from stewardai.bridge.speaker_events import SpeakerTracker


def test_tracker_reports_open_speaker():
    t = SpeakerTracker()
    assert t.current_speaker() is None
    t.on_event("Anique", "start", 1000)
    assert t.current_speaker() == "Anique"
    t.on_event("Anique", "end", 2000)
    assert t.current_speaker() is None


def test_tracker_most_recent_open_speaker_wins_on_overlap():
    t = SpeakerTracker()
    t.on_event("Anique", "start", 1000)
    t.on_event("Sarah", "start", 1500)  # overlap
    assert t.current_speaker() == "Sarah"
    t.on_event("Sarah", "end", 1800)
    assert t.current_speaker() == "Anique"  # Anique still open
