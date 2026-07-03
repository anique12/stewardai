from stewardai.agent.kb.filing import (
    HIGH_CONFIDENCE, LOW_CONFIDENCE, SpaceCandidate, decide_filing, score_candidates,
)


def test_score_candidates_sorted_desc_and_clamped():
    cands = score_candidates(hint_scores={"s1": 0.2, "s2": 0.9, "s3": 1.5})
    assert [c.space_id for c in cands] == ["s3", "s2", "s1"]
    assert cands[0].score == 1.0  # clamped to [0, 1]


def test_recurring_meeting_inherits_series_space():
    d = decide_filing(recurring_space_id="series-space", candidates=[], new_thread_name=None)
    assert d.action == "recurring" and d.space_id == "series-space" and d.confidence == 1.0


def test_high_confidence_candidate_auto_files():
    cands = [SpaceCandidate("s1", 0.9, "domain match")]
    d = decide_filing(recurring_space_id=None, candidates=cands, new_thread_name=None)
    assert d.action == "auto" and d.space_id == "s1" and d.confidence == 0.9


def test_new_thread_high_confidence_auto_creates_when_no_candidates():
    d = decide_filing(recurring_space_id=None, candidates=[], new_thread_name="Acme Corp")
    assert d.action == "auto_created" and d.space_id is None and d.new_space_name == "Acme Corp"


def test_medium_confidence_is_suggested():
    cands = [SpaceCandidate("s1", 0.5, "one attendee")]
    d = decide_filing(recurring_space_id=None, candidates=cands, new_thread_name=None)
    assert d.action == "suggested" and d.space_id == "s1"


def test_low_confidence_and_no_new_thread_is_unfiled():
    cands = [SpaceCandidate("s1", 0.2, "weak")]
    d = decide_filing(recurring_space_id=None, candidates=cands, new_thread_name=None)
    assert d.action == "unfiled" and d.space_id is None


def test_existing_candidate_wins_over_new_thread_when_high():
    # A strong existing match should file into it, not spawn a duplicate space.
    cands = [SpaceCandidate("s1", 0.95, "domain+attendees")]
    d = decide_filing(recurring_space_id=None, candidates=cands, new_thread_name="Acme Corp")
    assert d.action == "auto" and d.space_id == "s1"
